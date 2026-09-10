import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { eq } from "drizzle-orm";
import {
  getMachineLaunch,
  listPublicHosts,
  hosts,
  machineEnrollments,
  machineLaunches,
  setAppSettings,
} from "@bb/db";
import { defaultAppSettings } from "@bb/domain";
import type { ServerAccessGrant } from "@get-bb/plugin-sdk";
import { describe, expect, it, vi } from "vitest";
import { getMachineEnrollmentService } from "../../../src/services/machines/machine-services.js";
import { serverAccess } from "../../../src/services/machines/server-access.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

async function installPlugin(harness: TestAppHarness, id: string) {
  const root = join(harness.config.dataDir, `bb-plugin-${id}`);
  await mkdir(root, { recursive: true });
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({
      name: `bb-plugin-${id}`,
      version: "0.1.0",
      type: "module",
      bb: {
        name: id,
        description: "Machine enrollment regression fixture",
        branding: { icon: "Zap" },
        server: "./server.js",
      },
    }),
  );
  await writeFile(
    join(root, "server.js"),
    `export default function(bb) {
    bb.experimental_machines.register({
      id: "${id}-machine", displayName: "Runtime machine",
      description: "Provision a runtime test machine.", icon: "Terminal",

      reconcileCleanup: async () => ({ status: "removed" }),
      create: async () => ({ status: "failed", message: "unused" }),
      remove: async () => ({ status: "removed" })
    });
  }`,
  );
  const installed = await harness.pluginService.installPath(root);
  expect(installed.status).toBe("running");
  const api = harness.pluginService.getApi(id);
  if (!api) throw new Error("Plugin API was not loaded");
  return api;
}

function launch(harness: TestAppHarness, key: string, providerId: string) {
  harness.db
    .insert(machineLaunches)
    .values({
      key,
      providerId,
      attempt: 1,
      phase: "creating",
      startedAt: Date.now(),
      stepText: "checkpoint step",
      pendingLog: "checkpoint log",
      cancelPending: false,
      resource: { checkpoint: "preserve" },
    })
    .run();
}

describe("production machine enrollment wiring", () => {
  it("reads the current core resource across plugins without diagnostic storage", async () => {
    await withTestHarness(async (h) => {
      const api = await installPlugin(h, "resource-reader");
      const hostId = "resource-host";
      h.db
        .insert(hosts)
        .values({
          id: hostId,
          name: "Existing machine",
          machineProviderId: "another-plugin-machine",
          resource: { sandboxId: "sandbox-existing" },
          createdAt: 1,
          updatedAt: 1,
        })
        .run();
      expect(await api.experimental_machines.getResource(hostId)).toEqual({
        sandboxId: "sandbox-existing",
      });
      h.db
        .update(hosts)
        .set({ resource: { sandboxId: null, snapshotImageId: "image-1" } })
        .where(eq(hosts.id, hostId))
        .run();
      expect(await api.experimental_machines.getResource(hostId)).toEqual({
        sandboxId: null,
        snapshotImageId: "image-1",
      });
      h.db
        .update(hosts)
        .set({ resource: null })
        .where(eq(hosts.id, hostId))
        .run();
      expect(await api.experimental_machines.getResource(hostId)).toBeNull();
      expect(
        await api.experimental_machines.getResource("missing-host"),
      ).toBeNull();
    });
  });

  it("reserves the launch host through the loaded plugin and reuses production connection state", async () => {
    await withTestHarness(async (h) => {
      setAppSettings(h.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "direct",
        machineServerUrl: "https://machine.example.test",
      });
      const api = await installPlugin(h, "enrollment-runtime");
      launch(h, "runtime-launch", "enrollment-runtime-machine");
      const enrollment = await api.experimental_machines.enrollments.prepare({
        key: "runtime-launch",
      });
      expect(getMachineLaunch(h.db, "runtime-launch")).toMatchObject({
        hostId: enrollment.hostId,
        resource: { checkpoint: "preserve" },
        stepText: "checkpoint step",
        pendingLog: "checkpoint log",
      });
      expect(getMachineEnrollmentService(h.deps)).toBe(
        getMachineEnrollmentService(h.deps),
      );
      const reissued = await api.experimental_machines.enrollments.prepare({
        key: "runtime-launch",
      });
      expect(reissued).toMatchObject({
        id: enrollment.id,
        hostId: enrollment.hostId,
        state: "pending",
      });
      if (enrollment.state !== "pending" || reissued.state !== "pending")
        throw new Error("Expected pending enrollment");
      expect(reissued.bootstrap.credential).not.toBe(
        enrollment.bootstrap.credential,
      );
      const exec = vi.fn(async ({ stdin }: { stdin?: string }) => {
        if (stdin === undefined) throw new Error("Expected enrollment input");
        const input: unknown = JSON.parse(stdin);
        if (
          typeof input !== "object" ||
          input === null ||
          !("credential" in input) ||
          typeof input.credential !== "string"
        ) {
          throw new Error("Expected enrollment credential");
        }
        expect(
          await h.deps.machineAuth.enrollHost({
            hostId: enrollment.hostId,
            token: input.credential,
            allowPublicEnrollment: true,
          }),
        ).not.toBeNull();
        h.hub.registerDaemon("runtime-session", enrollment.hostId, {
          close() {},
          send() {},
        });
        return { exitCode: 0, stdout: "", stderr: "" };
      });
      await expect(
        api.experimental_machines.bootstrap({
          key: "runtime-launch",
          executor: { exec },
          report: { step() {}, log() {} },
          signal: new AbortController().signal,
        }),
      ).resolves.toBeUndefined();
      expect(exec).toHaveBeenCalledOnce();
      expect(
        await api.experimental_machines.enrollments.prepare({
          key: "runtime-launch",
        }),
      ).toEqual({
        id: enrollment.id,
        hostId: enrollment.hostId,
        state: "enrolled",
      });
      await expect(
        api.experimental_machines.enrollments.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: 100,
          signal: new AbortController().signal,
        }),
      ).resolves.toEqual({ hostId: enrollment.hostId });
      await h.pluginService.setEnabled("enrollment-runtime", false);
      expect(() =>
        api.experimental_machines.enrollments.prepare({ key: "after-disable" }),
      ).toThrow();
    });
  });

  it("rejects foreign launches, checkpoints before failed access, and releases with the original owner key", async () => {
    await withTestHarness(async (h) => {
      const api = await installPlugin(h, "enrollment-runtime");
      const other = await installPlugin(h, "enrollment-other");
      const release = vi.fn(async () => {});
      const acquire = vi.fn(
        async ({ hostId }: { hostId: string }): Promise<
          ServerAccessGrant | { status: "failed"; message: string }
        > => ({
          id: "runtime-grant",
          serverUrl: "https://machine.example.test",
        }),
      );
      api.experimental_serverAccess.register({
        id: "runtime-access",
        displayName: "Runtime access",
        description: "Reach the server through the runtime test provider.",
        availability: () => ({ status: "available" }),
        acquire,
        release,
      });
      launch(h, "failure-launch", "enrollment-runtime-machine");
      await expect(
        other.experimental_machines.enrollments.prepare({
          key: "failure-launch",
          access: { providerId: "runtime-access" },
        }),
      ).rejects.toThrow("different plugin");
      expect(h.db.select().from(machineEnrollments).all()).toEqual([]);
      acquire.mockResolvedValueOnce({
        status: "failed",
        message: "Cloud device may need dashboard revocation",
      });
      await expect(
        api.experimental_machines.enrollments.prepare({
          key: "failure-launch",
          access: { providerId: "runtime-access" },
        }),
      ).rejects.toThrow();
      const reserved = getMachineLaunch(h.db, "failure-launch");
      expect(reserved?.hostId).toBeTruthy();
      expect(reserved?.resource).toEqual({ checkpoint: "preserve" });
      expect(
        listPublicHosts(h.db).find((host) => host.id === reserved?.hostId)
          ?.teardownMessage,
      ).toBe("Cloud device may need dashboard revocation");
      const enrollment = await api.experimental_machines.enrollments.prepare({
        key: "failure-launch",
        access: { providerId: "runtime-access" },
      });
      expect(enrollment.hostId).toBe(reserved?.hostId);
      expect(
        listPublicHosts(h.db).some((host) => host.id === reserved?.hostId),
      ).toBe(false);
      await serverAccess.release(h.deps, {
        hostId: enrollment.hostId,
        key: enrollment.hostId,
      });
      expect(release).toHaveBeenCalledWith({
        key: JSON.stringify(["enrollment-runtime", "failure-launch"]),
        grantId: "runtime-grant",
        hostId: enrollment.hostId,
      });
      expect(
        h.db
          .select({ providerId: hosts.serverAccessProviderId })
          .from(hosts)
          .where(eq(hosts.id, enrollment.hostId))
          .get()?.providerId,
      ).toBeNull();
      const standalone = await api.experimental_machines.enrollments.prepare({
        key: "standalone",
        access: { providerId: "runtime-access" },
      });
      expect(standalone.hostId).not.toBe(enrollment.hostId);
      expect(getMachineLaunch(h.db, "standalone")).toBeNull();
    });
  });
});
