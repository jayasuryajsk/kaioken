import { eq } from "drizzle-orm";
import { expect, it, vi } from "vitest";
import { defaultAppSettings } from "@bb/domain";
import {
  machineEnrollments,
  getMachineLaunch,
  setAppSettings,
  listEvents,
} from "@bb/db";
import { withTestHarness } from "../../helpers/test-app.js";
import { seedHostSession, seedProjectWithSource } from "../../helpers/seed.js";
import { textInput } from "../../helpers/prompt-input.js";
import { createThreadFromRequest } from "../../../src/services/threads/thread-create.js";
import { advanceThreadProvisioning } from "../../../src/services/threads/thread-provisioning.js";
import {
  requestMachineRemoval,
  sweepProviderMachine,
  cancelMachineLaunch,
} from "../../../src/services/machines/provider-orchestration.js";

it.each(["cancel", "enroll"])(
  "never persists manual credentials in launches or provisioning transcripts after %s",
  async (settlement) => {
    await withTestHarness(async (h) => {
      setAppSettings(h.db, {
        ...defaultAppSettings,
        defaultMachineAccess: "direct",
        machineServerUrl: "https://machine.example.test",
      });
      await h.pluginService.install("builtin:machine-manual", { kind: "root" });
      const host = seedHostSession(h.deps, { id: "review-local" }).host;
      const { project } = seedProjectWithSource(h.deps, { hostId: host.id });
      const thread = await createThreadFromRequest(h.deps, {
        environment: {
          type: "provider",
          environmentProviderId: "project-checkout",
          machine: { type: "new", machineProviderId: "manual", inputs: null },
          inputs: {},
        },
        input: textInput("Manual enrollment"),
        origin: "app",
        projectId: project.id,
        providerId: "codex",
        model: "requested-model",
        startedOnBehalfOf: null,
      });
      await vi.waitFor(() =>
        expect(getMachineLaunch(h.db, thread.id)?.stepText).toBe(
          "Run the enrollment command shown in the picker",
        ),
      );
      const api = h.pluginService.getApi("machine-manual");
      if (!api) throw new Error("Missing plugin");
      const enrollment = await api.experimental_machines.enrollments.prepare({
        key: thread.id,
      });
      if (enrollment.state !== "pending")
        throw new Error("Expected pending enrollment");
      const readCommand = async () =>
        (
          await (
            await h.app.request("/api/v1/plugins/machine-manual/rpc/command", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ launchId: thread.id }),
            })
          ).json()
        ).result;
      expect((await readCommand()).command).toContain(
        enrollment.bootstrap.credential,
      );
      await advanceThreadProvisioning(h.deps, { threadId: thread.id });
      const assertRedacted = () => {
        const events = listEvents(h.db, { threadId: thread.id });
        expect(
          events.some((event) =>
            JSON.stringify(event).includes(
              "Run the enrollment command shown in the picker",
            ),
          ),
        ).toBe(true);
        expect(JSON.stringify(events)).not.toContain(
          enrollment.bootstrap.credential,
        );
        expect(JSON.stringify(getMachineLaunch(h.db, thread.id))).not.toContain(
          enrollment.bootstrap.credential,
        );
        expect(JSON.stringify(events)).not.toContain("BB_ENROLLMENT=");
      };
      assertRedacted();
      if (settlement === "enroll") {
        expect(
          await h.deps.machineAuth.enrollHost({
            hostId: enrollment.hostId,
            token: enrollment.bootstrap.credential,
            allowPublicEnrollment: true,
          }),
        ).not.toBeNull();
        h.hub.registerDaemon("manual-connected", enrollment.hostId, {
          close() {},
          send() {},
        });
      } else await cancelMachineLaunch(h.deps, thread.id);
      await vi.waitFor(async () =>
        expect(await readCommand()).toEqual({
          command: null,
          expiresAt: null,
        }),
      );
      assertRedacted();
      await cancelMachineLaunch(h.deps, thread.id);
    });
  },
);

it("resolves replacement launch identity while Manual owns command retrieval", async () => {
  await withTestHarness(async (h) => {
    setAppSettings(h.db, {
      ...defaultAppSettings,
      defaultMachineAccess: "direct",
      machineServerUrl: "https://machine.example.test",
    });
    await h.pluginService.install("builtin:machine-manual", { kind: "root" });
    const host = seedHostSession(h.deps, { id: "replacement-local" }).host;
    const { project } = seedProjectWithSource(h.deps, { hostId: host.id });
    const thread = await createThreadFromRequest(h.deps, {
      environment: {
        type: "provider",
        environmentProviderId: "project-checkout",
        machine: { type: "new", machineProviderId: "manual", inputs: null },
        inputs: {},
      },
      input: textInput("Manual replacement enrollment"),
      origin: "app",
      projectId: project.id,
      providerId: "codex",
      model: "requested-model",
      startedOnBehalfOf: null,
    });
    const api = h.pluginService.getApi("machine-manual");
    if (!api) throw new Error("Missing plugin");
    const url = (id: string) =>
      `/api/v1/hosts/launches/${encodeURIComponent(id)}`;
    const threadUrl = `${url(thread.id)}?scope=thread`;
    const readCommand = async (launchId: string) => {
      const response = await h.app.request(
        "/api/v1/plugins/machine-manual/rpc/command",
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ launchId }),
        },
      );
      return (await response.json()).result;
    };
    const consumedKeys: string[] = [];
    let key = thread.id;
    for (let generation = 0; generation < 3; generation++) {
      await vi.waitFor(() =>
        expect(getMachineLaunch(h.db, key)?.stepText).toBe(
          "Run the enrollment command shown in the picker",
        ),
      );
      const enrollment = await api.experimental_machines.enrollments.prepare({
        key,
      });
      if (enrollment.state !== "pending")
        throw new Error("Expected enrollment");
      const response = await h.app.request(threadUrl);
      const install = () =>
        h.app.request("/install.sh", {
          headers: { "X-BB-Enrollment": enrollment.bootstrap.credential },
        });
      const installer = await install();
      expect(installer.status).toBe(200);
      expect(installer.headers.get("cache-control")).toBe("no-store");
      expect(await installer.text()).toContain(
        "set -- --bootstrap-env BB_ENROLLMENT",
      );
      expect(
        (
          await h.app.request("/install.sh", {
            headers: { "X-BB-Enrollment": "invalid-enrollment" },
          })
        ).status,
      ).toBe(403);

      expect((await response.json()).id).toBe(key);
      expect((await readCommand(key)).command).toContain(
        enrollment.bootstrap.credential,
      );
      for (const consumed of consumedKeys) {
        expect(await readCommand(consumed)).toEqual({
          command: null,
          expiresAt: null,
        });
      }
      expect((await h.app.request(`${url(key)}?scope=invalid`)).status).toBe(
        400,
      );
      const forbidden = await h.app.request(threadUrl, {
        headers: {
          "x-bb-gate-auth": "machine",
          "x-bb-gate-machine-id": enrollment.hostId,
        },
      });
      expect(forbidden.status).toBe(403);
      if (generation === 2) {
        h.db
          .update(machineEnrollments)
          .set({ expiresAt: Date.now() - 1 })
          .where(eq(machineEnrollments.id, enrollment.id))
          .run();
        expect((await install()).status).toBe(403);
        h.db
          .update(machineEnrollments)
          .set({ expiresAt: enrollment.expiresAt })
          .where(eq(machineEnrollments.id, enrollment.id))
          .run();
        await cancelMachineLaunch(h.deps, key);
        expect((await install()).status).toBe(403);
        expect(await readCommand(key)).toEqual({
          command: null,
          expiresAt: null,
        });
        break;
      }
      expect(
        await h.deps.machineAuth.enrollHost({
          hostId: enrollment.hostId,
          token: enrollment.bootstrap.credential,
          allowPublicEnrollment: true,
        }),
      ).not.toBeNull();
      expect((await install()).status).toBe(403);
      h.hub.registerDaemon(
        `replacement-session-${generation}`,
        enrollment.hostId,
        {
          close() {},
          send() {},
        },
      );
      await vi.waitFor(() =>
        expect(getMachineLaunch(h.db, key)?.phase).toBe("ready"),
      );
      expect(await readCommand(key)).toEqual({
        command: null,
        expiresAt: null,
      });
      expect(requestMachineRemoval(h.deps, enrollment.hostId)).toBe(true);
      await sweepProviderMachine(h.deps, enrollment.hostId);
      consumedKeys.push(key);
      key = `${thread.id}:replacement:${enrollment.hostId}`;
      expect(await readCommand(key)).toEqual({
        command: null,
        expiresAt: null,
      });
      await advanceThreadProvisioning(h.deps, { threadId: thread.id });
    }
  });
}, 20000);
