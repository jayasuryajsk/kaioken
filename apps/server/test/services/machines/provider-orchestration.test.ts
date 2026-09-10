import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createEnvironment,
  createHostId,
  getHost,
  hosts,
  updateHost,
} from "@bb/db";
import { createDeferredPromise } from "@bb/test-helpers";
import type { JsonValue } from "@bb/domain";
import type { PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import { validatePluginMachineProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import {
  askMachineLaunch,
  requestAutomaticMachineRemoval,
  requestMachineRemoval,
  submitMachine,
  sweepMachineLifecycles,
  sweepProviderMachine,
} from "../../../src/services/machines/provider-orchestration.js";
import { setPluginMachineProviderBridge } from "../../../src/services/plugins/plugin-machine-provider-registry.js";
import { seedProjectWithSource, seedThread } from "../../helpers/seed.js";
import { withTestHarness } from "../../helpers/test-app.js";

function installMachineProvider(
  overrides: Partial<PluginMachineProviderDeclaration> = {},
) {
  const record = {
    pluginId: "test-machine-plugin",
    provider: validatePluginMachineProviderDeclaration({
      id: "test-machine",
      displayName: "Test machine",
      description: "Provision a test machine.",
      icon: "Terminal",
      create: async ({ key }) => ({
        status: "created" as const,
        name: "Created machine",
        resource: { key },
      }),
      reconcileCleanup: async () => ({ status: "removed" as const }),
      remove: async () => ({ status: "removed" as const }),
      ...overrides,
    }),
  };
  setPluginMachineProviderBridge({
    listMachineProviders: () => [record],
    getMachineProvider: (id) =>
      id === record.provider.id ? record : undefined,
    invokeProvider: async (_pluginId, _label, run) => {
      try {
        return { ok: true as const, value: await run() };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    decisionTimeoutMs: 10_000,
  });
  return record;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setPluginMachineProviderBridge(undefined);
});

describe("machine creation hosts", () => {
  it("persists a creating host before allocation and resumes it after restart", async () =>
    withTestHarness(async (harness) => {
      const started = createDeferredPromise<void>();
      const release = createDeferredPromise<void>();
      const calls: Array<{ attempt: number; key: string }> = [];
      installMachineProvider({
        create: async ({ attempt, key }) => {
          calls.push({ attempt, key });
          started.resolve();
          await release.promise;
          return {
            status: "created",
            name: "Recovered machine",
            resource: { allocation: "same" },
          };
        },
      });

      const submitted = await submitMachine(harness.deps, {
        key: "thread-machine",
        machineProviderId: "test-machine",
        inputs: null,
      });
      await started.promise;
      expect(submitted).toMatchObject({
        id: expect.stringMatching(/^host_/u),
        lifecycle: {
          phase: "creating",
          message: "Creating Test machine…",
        },
      });
      expect(getHost(harness.db, submitted.id)).toMatchObject({
        launchKey: "thread-machine",
        attempt: 1,
        phase: "creating",
      });

      release.resolve();
      await expect
        .poll(() => getHost(harness.db, submitted.id)?.phase)
        .toBe("active");
      expect(calls).toEqual([{ attempt: 1, key: "thread-machine" }]);
      expect(getHost(harness.db, submitted.id)).toMatchObject({
        name: "Recovered machine",
        inputs: null,
        resource: { allocation: "same" },
      });

      const restartedId = createHostId();
      const now = Date.now();
      harness.db
        .insert(hosts)
        .values({
          id: restartedId,
          name: "Test machine restart",
          type: "persistent",
          machineProviderId: "test-machine",
          machineOperationId: "test-machine-plugin:restart",
          launchKey: "restart-key",
          inputs: null,
          attempt: 1,
          phase: "creating",
          statusMessage: "Creating Test machine…",
          createdAt: now,
          updatedAt: now,
        })
        .run();
      await sweepMachineLifecycles(harness.deps);
      expect(getHost(harness.db, restartedId)).toMatchObject({
        phase: "active",
        resource: { allocation: "same" },
      });
    }));

  it("uses one live row per launch key and reuses the key after destruction", async () =>
    withTestHarness(async (harness) => {
      const record = installMachineProvider();
      expect(
        askMachineLaunch(harness.deps, {
          key: "stable-key",
          record,
          inputs: null,
        }).action,
      ).toBe("wait");
      await expect
        .poll(
          () =>
            harness.db
              .select()
              .from(hosts)
              .all()
              .find((row) => row.launchKey === "stable-key")?.phase,
        )
        .toBe("active");
      const firstHost = harness.db
        .select()
        .from(hosts)
        .all()
        .find((row) => row.launchKey === "stable-key")!;
      expect(requestMachineRemoval(harness.deps, firstHost.id)).toBe(true);
      await sweepProviderMachine(harness.deps, firstHost.id);
      expect(getHost(harness.db, firstHost.id)?.phase).toBe("destroyed");

      askMachineLaunch(harness.deps, {
        key: "stable-key",
        record,
        inputs: null,
      });
      const rows = harness.db
        .select()
        .from(hosts)
        .all()
        .filter((row) => row.launchKey === "stable-key");
      expect(rows).toHaveLength(2);
      expect(rows.find((row) => row.destroyedAt === null)).toMatchObject({
        attempt: 2,
        phase: "creating",
      });
    }));

  it("cancels by removing and reconciles without a checkpoint", async () =>
    withTestHarness(async (harness) => {
      const started = createDeferredPromise<void>();
      const reconcileCleanup = vi.fn(async () => ({
        status: "removed" as const,
      }));
      installMachineProvider({
        create: async ({ signal }) => {
          started.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
          throw new Error("unreachable");
        },
        reconcileCleanup,
      });
      const host = await submitMachine(harness.deps, {
        key: "cancel-key",
        machineProviderId: "test-machine",
        inputs: null,
      });
      await started.promise;

      const response = await harness.app.request(`/api/v1/hosts/${host.id}`, {
        method: "DELETE",
      });
      expect(response.status).toBe(200);
      expect(reconcileCleanup).toHaveBeenCalledOnce();
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it("removes a checkpoint and fences stale checkpoint ownership", async () =>
    withTestHarness(async (harness) => {
      const checkpointed = createDeferredPromise<void>();
      const release = createDeferredPromise<void>();
      let lateCheckpoint: ((value: JsonValue) => Promise<void>) | undefined;
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      installMachineProvider({
        create: async ({ checkpoint, signal }) => {
          lateCheckpoint = checkpoint;
          await checkpoint({ allocation: "one" });
          checkpointed.resolve();
          await release.promise;
          signal.throwIfAborted();
          return {
            status: "created",
            name: "Checkpointed machine",
            resource: { allocation: "one" },
          };
        },
        remove,
      });
      const host = await submitMachine(harness.deps, {
        key: "checkpoint-key",
        machineProviderId: "test-machine",
        inputs: null,
      });
      await checkpointed.promise;
      const operationId = getHost(harness.db, host.id)!.machineOperationId;
      updateHost(harness.db, harness.hub, host.id, {
        machineOperationId: "test-machine-plugin:replacement-owner",
      });
      await expect(lateCheckpoint?.({ allocation: "stale" })).rejects.toThrow(
        "no longer owns",
      );
      updateHost(harness.db, harness.hub, host.id, {
        machineOperationId: operationId,
      });
      expect(requestMachineRemoval(harness.deps, host.id)).toBe(true);
      release.resolve();
      await sweepProviderMachine(harness.deps, host.id);
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: host.id,
          resource: { allocation: "one" },
        }),
      );
    }));
});

describe("machine retirement", () => {
  it("keeps persistent machines and ephemeral machines with live threads", async () =>
    withTestHarness(async (harness) => {
      installMachineProvider({ ephemeral: true });
      const ephemeralId = createHostId();
      const now = Date.now();
      harness.db
        .insert(hosts)
        .values({
          id: ephemeralId,
          name: "Ephemeral machine",
          type: "ephemeral",
          machineProviderId: "test-machine",
          phase: "active",
          resource: { allocation: "one" },
          createdAt: now,
          updatedAt: now,
        })
        .run();
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: ephemeralId,
        path: "/tmp/ephemeral",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: ephemeralId,
        path: "/tmp/ephemeral",
        providerOwnsPath: false,
        status: "ready",
        environmentProvider: null,
      });
      seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      expect(requestAutomaticMachineRemoval(harness.deps, ephemeralId)).toBe(
        false,
      );
      updateHost(harness.db, harness.hub, ephemeralId, {
        type: "persistent",
      });
      expect(requestAutomaticMachineRemoval(harness.deps, ephemeralId)).toBe(
        false,
      );
    }));

  it("retries failed teardown at removeRetryAt", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const remove = vi
        .fn()
        .mockResolvedValueOnce({ status: "failed" as const, message: "busy" })
        .mockResolvedValueOnce({ status: "removed" as const });
      installMachineProvider({ remove });
      const id = createHostId();
      harness.db
        .insert(hosts)
        .values({
          id,
          name: "Remove me",
          type: "ephemeral",
          machineProviderId: "test-machine",
          phase: "active",
          resource: { allocation: "one" },
          createdAt: 1,
          updatedAt: 1,
        })
        .run();

      await sweepMachineLifecycles(harness.deps);
      expect(getHost(harness.db, id)).toMatchObject({
        phase: "removing",
        removeRetryAt: 80_000,
        teardownStatus: "failed",
      });
      vi.setSystemTime(79_999);
      await sweepMachineLifecycles(harness.deps);
      expect(remove).toHaveBeenCalledOnce();
      vi.setSystemTime(80_000);
      await sweepMachineLifecycles(harness.deps);
      expect(remove).toHaveBeenCalledTimes(2);
      expect(getHost(harness.db, id)?.phase).toBe("destroyed");
    }));
});
