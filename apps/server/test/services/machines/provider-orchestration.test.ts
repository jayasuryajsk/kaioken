import { attemptDispatch } from "../../../src/services/threads/dispatch-attempt.js";
import { listQueuedThreadMessages } from "@bb/db";
import * as gitCredentials from "../../../src/services/machines/git-credentials.js";
import {
  createTerminalSession,
  createQueuedThreadMessage,
  terminalSessions,
  events,
  getThread,
} from "@bb/db";
import { seedTurnStarted } from "../../helpers/seed.js";
import { assertMachineLifecycleAdmission } from "../../../src/services/machines/lifecycle.js";
import { archiveThreadAndHiddenSourceForks } from "../../../src/services/threads/thread-archive.js";
import { cancelAbandonedProviderLaunches } from "../../../src/services/threads/thread-environment-providers.js";
import { serverAccess } from "../../../src/services/machines/server-access.js";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import {
  createProjectSource,
  environments,
  environmentHookOperations,
  machineEnrollments,
  createEnvironment,
  getDefaultProjectSource,
  getEnvironment,
  getHost,
  getMachineLaunch,
  listProjectSourcesByProjectIds,
  threads,
  updateHost,
  upsertMachineLaunch,
  updateMachineLaunchAttempt,
} from "@bb/db";
import { hostSchema, type Host, type JsonValue } from "@bb/domain";
import { createDeferredPromise } from "@bb/test-helpers";
import type { PluginMachineProviderDeclaration } from "@get-bb/plugin-sdk";
import {
  validatePluginEnvironmentProviderDeclaration,
  validatePluginMachineProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import { z } from "zod";
import {
  askMachineLaunch,
  submitMachine,
  resumeMachine,
  cancelMachineLaunch,
  createMachine,
  prepareMachineProviderSelection,
  requestMachineRemoval,
  requestMachineResume,
  requestMachineSuspension,
  resolveThreadMachineLaunchKey,
  sweepMachineLifecycles,
  sweepProviderMachine,
} from "../../../src/services/machines/provider-orchestration.js";
import { setPluginMachineProviderBridge } from "../../../src/services/plugins/plugin-machine-provider-registry.js";
import { setPluginEnvironmentProviderBridge } from "../../../src/services/plugins/plugin-environment-provider-registry.js";
import { sweepProviderEnvironment } from "../../../src/services/environments/provider-orchestration.js";
import {
  seedHostSession,
  seedProjectWithSource,
  seedThread,
  seedThreadRuntimeState,
} from "../../helpers/seed.js";
import { registerTestHostRpcCapture } from "../../helpers/commands.js";
import { textInput } from "../../helpers/prompt-input.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";
import { sendThreadMessage } from "../../../src/services/threads/thread-send.js";
import { ensureHostSessionReadyForWork } from "../../../src/services/hosts/host-lifecycle.js";
import { registerHostRpcResponder } from "../../helpers/host-rpc.js";

function installMachineProvider(declaration: PluginMachineProviderDeclaration) {
  const record = {
    pluginId: "test-machine-plugin",
    provider: validatePluginMachineProviderDeclaration(declaration),
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

function machineDeclaration(
  _hostId: string,
  overrides: Partial<PluginMachineProviderDeclaration> = {},
): PluginMachineProviderDeclaration {
  return {
    description: "Provision a test machine.",
    icon: "Terminal",
    id: "test-machine",
    displayName: "Test machine",

    reconcileCleanup: async () => ({ status: "removed" }),
    create: async ({ key }) => ({
      status: "created",
      name: "Test machine",
      resource: { key },
    }),
    remove: async () => ({ status: "removed" }),
    ...overrides,
  };
}

function adoptMachine(
  harness: TestAppHarness,
  hostId: string,
  resource: JsonValue = { machine: "resource" },
  type: Host["type"] = "persistent",
): void {
  updateHost(harness.db, harness.hub, hostId, {
    type,
    machineProviderId: "test-machine",
    machineProviderSelection: { inputs: null },
    phase: "active",
    resource,
  });
}

beforeEach(() => {
  vi.spyOn(gitCredentials, "resolveGitCredentials").mockResolvedValue([]);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  setPluginMachineProviderBridge(undefined);
  setPluginEnvironmentProviderBridge(undefined);
});

function seedMachineWorkspace(
  harness: TestAppHarness,
  hostId: string,
  path: string,
) {
  const { project } = seedProjectWithSource(harness.deps, { hostId, path });
  const environment = createEnvironment(harness.db, harness.hub, {
    projectId: project.id,
    hostId,
    path,
    providerOwnsPath: false,
    status: "ready",
    environmentProvider: null,
  });
  return { project, environment };
}

function seedReadyLaunch(
  harness: TestAppHarness,
  args: { key: string; hostId: string },
) {
  upsertMachineLaunch(harness.db, {
    key: args.key,
    providerId: "test-machine",
    inputs: null,
    attempt: 1,
    phase: "ready",
    startedAt: Date.now(),
    failedAt: null,
    failure: null,
    message: null,
    hostId: args.hostId,
    resource: { key: args.key },
    stepText: "Ready",
    pendingLog: "",
    cancelPending: false,
  });
}

function reserveLaunchHost(
  harness: TestAppHarness,
  key: string,
  hostId: string,
): void {
  const row = getMachineLaunch(harness.db, key);
  if (row === null) throw new Error("Missing launch");
  updateMachineLaunchAttempt(harness.db, { ...row, hostId });
}

describe("core machine provider orchestration", () => {
  it("restarts a persisted create with the same idempotency key after a server crash", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host_machine" });
      const calls: Array<{ attempt: number; key: string }> = [];
      const record = installMachineProvider(
        machineDeclaration(host.id, {
          create: async ({ attempt, key }) => {
            calls.push({ attempt, key });
            reserveLaunchHost(harness, key, host.id);
            return {
              status: "created",
              name: "Test machine",
              resource: { key },
            };
          },
        }),
      );
      upsertMachineLaunch(harness.db, {
        key: "durable-machine-key",
        providerId: record.provider.id,
        inputs: null,
        attempt: 4,
        phase: "creating",
        startedAt: Date.now() - 1_000,
        failedAt: null,
        failure: null,
        message: null,
        hostId: null,
        resource: null,
        stepText: "Creating Test machine…",
        pendingLog: "",
        cancelPending: false,
      });

      expect(
        askMachineLaunch(harness.deps, {
          key: "durable-machine-key",
          record,
          inputs: null,
        }).action,
      ).toBe("wait");
      await expect
        .poll(() => getMachineLaunch(harness.db, "durable-machine-key")?.phase)
        .toBe("ready");
      expect(calls).toEqual([{ attempt: 4, key: "durable-machine-key" }]);
      expect(getHost(harness.db, host.id)).toMatchObject({
        name: "Test machine",
        machineProviderId: "test-machine",
        resource: { key: "durable-machine-key" },
      });
    }));

  it("falls back to a readable provider name for legacy create results", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host_legacy" });
      const create = async ({ key }: { key: string }) => {
        reserveLaunchHost(harness, key, host.id);
        return { status: "created" as const, resource: { key } };
      };
      installMachineProvider(
        machineDeclaration(host.id, {
          create:
            create as unknown as PluginMachineProviderDeclaration["create"],
        }),
      );

      await createMachine(harness.deps, {
        key: "legacy-machine-key",
        machineProviderId: "test-machine",
        inputs: null,
      });

      expect(getHost(harness.db, host.id)?.name).toBe("Test machine legacy");
    }));

  it("parses inputs once and persists the parsed value on the launch and machine", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host_inputs" });
      const seen: JsonValue[] = [];
      installMachineProvider(
        machineDeclaration(host.id, {
          inputs: z.object({ target: z.string().trim().min(1) }).strict(),
          create: async ({ inputs, key }) => {
            seen.push(z.object({ target: z.string() }).strict().parse(inputs));
            reserveLaunchHost(harness, key, host.id);
            return {
              status: "created",
              name: "Test machine",
              resource: { key },
            };
          },
        }),
      );

      await createMachine(harness.deps, {
        key: "inputs-key",
        machineProviderId: "test-machine",
        inputs: { target: "  staging  " },
      });
      expect(seen).toEqual([{ target: "staging" }]);
      expect(getMachineLaunch(harness.db, "inputs-key")?.inputs).toEqual({
        target: "staging",
      });
      expect(getHost(harness.db, host.id)?.machineProviderSelection).toEqual({
        inputs: { target: "staging" },
      });
    }));

  it("rejects an unknown machine provider", async () =>
    withTestHarness(async (harness) => {
      await expect(
        prepareMachineProviderSelection(harness.deps, {
          machineProviderId: "missing-machine",
          inputs: null,
        }),
      ).rejects.toThrow('Unknown machine provider "missing-machine"');
    }));

  it("checks only the selected machine provider's availability at creation", async () =>
    withTestHarness(async (harness) => {
      const availability = vi.fn(() => ({
        status: "setup-required" as const,
        message: "Configure the machine provider",
      }));
      installMachineProvider(
        machineDeclaration("host_unavailable", { availability }),
      );

      await expect(
        prepareMachineProviderSelection(harness.deps, {
          machineProviderId: "test-machine",
          inputs: null,
        }),
      ).rejects.toThrow("Configure the machine provider");
      expect(availability).toHaveBeenCalledOnce();
    }));

  it("recovers and removes a machine when creation is cancelled", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host_cancel" });
      const calls: string[] = [];
      const record = installMachineProvider(
        machineDeclaration(host.id, {
          create: ({ key, signal }) =>
            new Promise((_resolve, reject) => {
              calls.push(`create:${key}`);
              const row = getMachineLaunch(harness.db, key);
              if (row === null) throw new Error("Missing launch");
              updateMachineLaunchAttempt(harness.db, {
                ...row,
                hostId: host.id,
              });
              signal.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true },
              );
            }),
          reconcileCleanup: async ({ key }) => {
            calls.push(`reconcile:${key}`);
            return { status: "removed" };
          },
        }),
      );

      askMachineLaunch(harness.deps, {
        key: "cancel-key",
        record,
        inputs: null,
      });
      await cancelMachineLaunch(harness.deps, "cancel-key");

      expect(calls).toEqual(["create:cancel-key", "reconcile:cancel-key"]);
      expect(getMachineLaunch(harness.db, "cancel-key")).toMatchObject({
        phase: "cancelled",
        cancelPending: false,
      });
      expect(getHost(harness.db, host.id)).toMatchObject({
        destroyedAt: expect.any(Number),
        phase: "destroyed",
      });
    }));

  it("removes checkpointed allocations without reconnecting and retries access independently", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const { host } = seedHostSession(harness.deps, {
        id: "host_checkpoint_cancel",
      });
      const checkpointed = createDeferredPromise<void>();
      const create = vi.fn(
        async (
          context: Parameters<PluginMachineProviderDeclaration["create"]>[0],
        ) => {
          const row = getMachineLaunch(harness.db, context.key);
          if (row === null) throw new Error("Missing launch");
          updateMachineLaunchAttempt(harness.db, { ...row, hostId: host.id });
          await context.checkpoint({ allocation: "vendor-id" });
          checkpointed.resolve();
          await new Promise<void>((_resolve, reject) => {
            context.signal.addEventListener(
              "abort",
              () => reject(new Error("unreachable server")),
              { once: true },
            );
          });
          return {
            status: "failed" as const,
            message: "unreachable",
          };
        },
      );
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      const record = installMachineProvider(
        machineDeclaration(host.id, { create, remove }),
      );
      askMachineLaunch(harness.deps, {
        key: "checkpoint-cancel",
        record,
        inputs: null,
      });
      await checkpointed.promise;
      const revoke = vi
        .spyOn(serverAccess, "release")
        .mockRejectedValueOnce(new Error("revocation unavailable"));
      await expect(
        cancelMachineLaunch(harness.deps, "checkpoint-cancel"),
      ).rejects.toThrow("revocation unavailable");
      expect(getMachineLaunch(harness.db, "checkpoint-cancel")).toMatchObject({
        cleanupResourceRemoved: true,
        cancelPending: true,
      });
      await sweepMachineLifecycles(harness.deps);
      expect(revoke).toHaveBeenCalledOnce();
      expect(
        getMachineLaunch(harness.db, "checkpoint-cancel")?.cleanupRetryAt,
      ).toBe(80_000);
      vi.setSystemTime(80_000);
      await sweepMachineLifecycles(harness.deps);
      expect(revoke).toHaveBeenCalledTimes(2);
      expect(create).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledOnce();
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: host.id,
          resource: { allocation: "vendor-id" },
        }),
      );
      expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
      revoke.mockRestore();
    }));

  it("finalizes host cleanup when creation succeeds after cancellation", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host_late_cancel",
      });
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      const record = installMachineProvider(
        machineDeclaration(host.id, {
          create: ({ key, signal }) =>
            new Promise((resolve) => {
              reserveLaunchHost(harness, key, host.id);
              signal.addEventListener(
                "abort",
                () =>
                  resolve({
                    status: "created",
                    name: "Test machine",
                    resource: { allocation: "late" },
                  }),
                { once: true },
              );
            }),
          remove,
        }),
      );
      askMachineLaunch(harness.deps, {
        key: "late-cancel",
        record,
        inputs: null,
      });
      await cancelMachineLaunch(harness.deps, "late-cancel");
      expect(remove).toHaveBeenCalledOnce();
      expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
      expect(getMachineLaunch(harness.db, "late-cancel")).toMatchObject({
        cancelPending: false,
        cleanupResourceRemoved: true,
      });
    }));

  it("retains checkpoints while cleaning up a terminal create failure", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host_terminal_failure",
      });
      const resource = { allocation: "allocated-terminal" };
      const create = vi.fn(async () => ({
        status: "failed" as const,
        message: "access unavailable",
      }));
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      const record = installMachineProvider(
        machineDeclaration(host.id, { create, remove }),
      );
      const key = "failure-terminal";
      upsertMachineLaunch(harness.db, {
        key,
        providerId: record.provider.id,
        inputs: null,
        attempt: 1,
        phase: "failed",
        startedAt: Date.now() - 60_000,
        failedAt: Date.now() - 60_000,
        failure: "terminal",
        message: "bootstrap failed",
        hostId: host.id,
        resource,
        stepText: "Bootstrap failed",
        pendingLog: "",
        cancelPending: false,
      });
      expect(
        askMachineLaunch(harness.deps, { key, record, inputs: null }),
      ).toMatchObject({ action: "reject", message: "bootstrap failed" });
      await sweepMachineLifecycles(harness.deps);
      expect(create).not.toHaveBeenCalled();
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({ hostId: host.id, resource }),
      );
      expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
    }));

  it("keeps cancellation pending after a transient recovery failure and retries after the retry deadline", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const { host } = seedHostSession(harness.deps, {
        id: "host_cancel_retry",
      });
      const calls: string[] = [];
      let attempts = 0;
      const record = installMachineProvider(
        machineDeclaration(host.id, {
          reconcileCleanup: async () => {
            attempts += 1;
            calls.push(`reconcile:${attempts}`);
            return attempts === 1
              ? {
                  status: "failed",
                  message: "Modal lookup timed out",
                }
              : {
                  status: "removed",
                };
          },
          remove: async () => {
            calls.push("remove");
            return { status: "removed" };
          },
        }),
      );
      upsertMachineLaunch(harness.db, {
        key: "cancel-retry-key",
        providerId: record.provider.id,
        inputs: null,
        attempt: 1,
        phase: "cancelled",
        startedAt: Date.now(),
        failedAt: null,
        failure: null,
        message: null,
        hostId: null,
        resource: null,
        stepText: "Cancelling Test machine…",
        pendingLog: "",
        cancelPending: true,
      });

      await sweepMachineLifecycles(harness.deps);
      expect(calls).toEqual(["reconcile:1"]);
      expect(getMachineLaunch(harness.db, "cancel-retry-key")).toMatchObject({
        phase: "cancelled",
        cancelPending: true,
      });

      await sweepMachineLifecycles(harness.deps);
      expect(calls).toEqual(["reconcile:1"]);
      vi.setSystemTime(80_000);
      await sweepMachineLifecycles(harness.deps);
      expect(calls).toEqual(["reconcile:1", "reconcile:2"]);
      expect(getMachineLaunch(harness.db, "cancel-retry-key")).toMatchObject({
        phase: "cancelled",
        cancelPending: false,
      });
    }));

  it("rejects reuse of an API key whose ready machine was destroyed", async () =>
    withTestHarness(async (harness) => {
      const { host: destroyedHost } = seedHostSession(harness.deps, {
        id: "host_destroyed_launch",
      });
      const { host: replacementHost } = seedHostSession(harness.deps, {
        id: "host_replacement_launch",
      });
      updateHost(harness.db, harness.hub, destroyedHost.id, {
        destroyedAt: Date.now(),
        phase: "destroyed",
      });
      const calls: number[] = [];
      const record = installMachineProvider(
        machineDeclaration(replacementHost.id, {
          create: async ({ attempt, key }) => {
            calls.push(attempt);
            return {
              status: "created",
              name: "Test machine",
              resource: { key },
            };
          },
        }),
      );
      upsertMachineLaunch(harness.db, {
        key: "ready-destroyed-key",
        providerId: record.provider.id,
        inputs: null,
        attempt: 1,
        phase: "ready",
        startedAt: Date.now() - 1_000,
        failedAt: null,
        failure: null,
        message: null,
        hostId: destroyedHost.id,
        resource: { key: "ready-destroyed-key" },
        stepText: "Ready",
        pendingLog: "",
        cancelPending: false,
      });

      expect(
        askMachineLaunch(harness.deps, {
          key: "ready-destroyed-key",
          record,
          inputs: null,
        }).action,
      ).toBe("reject");
      await expect(
        createMachine(harness.deps, {
          key: "ready-destroyed-key",
          machineProviderId: record.provider.id,
          inputs: null,
        }),
      ).rejects.toMatchObject({
        status: 409,
        message: expect.stringContaining("destroyed machine"),
      });
      expect(calls).toEqual([]);
      expect(getMachineLaunch(harness.db, "ready-destroyed-key")).toMatchObject(
        {
          phase: "ready",
          attempt: 1,
          hostId: destroyedHost.id,
          resource: { key: "ready-destroyed-key" },
        },
      );
    }));

  it("keeps late cleanup from an old attempt on its old host and resource", async () =>
    withTestHarness(async (harness) => {
      const oldHost = seedHostSession(harness.deps, {
        id: "generation-old-late",
      }).host;
      const newHost = seedHostSession(harness.deps, {
        id: "generation-new-live",
      }).host;
      const oldResult = createDeferredPromise<{
        status: "created";
        name: string;
        resource: { key: string };
      }>();
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      const base = "thread-late-generation";
      const record = installMachineProvider(
        machineDeclaration(newHost.id, {
          create: ({ key }) => {
            if (key === base) return oldResult.promise;
            reserveLaunchHost(harness, key, newHost.id);
            return Promise.resolve({
              status: "created",
              name: "Test machine",
              resource: { key },
            });
          },
          remove,
        }),
      );
      askMachineLaunch(harness.deps, {
        key: base,
        record,
        inputs: null,
      });
      seedReadyLaunch(harness, { key: base, hostId: oldHost.id });
      updateHost(harness.db, harness.hub, oldHost.id, {
        destroyedAt: Date.now(),
        phase: "destroyed",
      });
      const key = resolveThreadMachineLaunchKey(harness.deps, base);
      askMachineLaunch(harness.deps, {
        key,
        record,
        inputs: null,
      });
      await vi.waitFor(() =>
        expect(getMachineLaunch(harness.db, key)?.phase).toBe("ready"),
      );
      oldResult.resolve({
        status: "created",
        name: "Test machine",
        resource: { key: base },
      });
      await vi.waitFor(() => expect(remove).toHaveBeenCalledOnce());
      expect(remove).toHaveBeenCalledWith(
        expect.objectContaining({
          hostId: oldHost.id,
          resource: { key: base },
        }),
      );
      await cancelMachineLaunch(harness.deps, base);
      expect(getHost(harness.db, newHost.id)).toMatchObject({
        destroyedAt: null,
        phase: "active",
        resource: { key },
      });
      expect(getMachineLaunch(harness.db, key)).toMatchObject({
        phase: "ready",
        hostId: newHost.id,
        resource: { key },
      });
    }));

  it.each(["archive", "abandon"] as const)(
    "cancels only the current generation on thread %s",
    async (action) =>
      withTestHarness(async (harness) => {
        const oldHost = seedHostSession(harness.deps, {
          id: "generation-cancel-old",
        }).host;
        const newHost = seedHostSession(harness.deps, {
          id: "generation-cancel-new",
        }).host;
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: oldHost.id,
        });
        const thread = seedThread(harness.deps, {
          projectId: project.id,
          environmentId: null,
          status: "starting",
        });
        seedReadyLaunch(harness, { key: thread.id, hostId: oldHost.id });
        updateHost(harness.db, harness.hub, oldHost.id, {
          destroyedAt: Date.now(),
          phase: "destroyed",
        });
        const key = resolveThreadMachineLaunchKey(harness.deps, thread.id);
        const remove = vi.fn(async () => ({ status: "removed" as const }));
        const create = vi.fn(
          ({ signal, key }: { signal: AbortSignal; key: string }) =>
            new Promise<{
              status: "created";
              name: string;
              resource: { key: string };
            }>((resolve) => {
              reserveLaunchHost(harness, key, newHost.id);
              signal.addEventListener(
                "abort",
                () =>
                  resolve({
                    status: "created",
                    name: "Test machine",
                    resource: { key },
                  }),
                { once: true },
              );
            }),
        );
        const record = installMachineProvider(
          machineDeclaration(newHost.id, { create, remove }),
        );
        askMachineLaunch(harness.deps, { key, record, inputs: null });
        await vi.waitFor(() => expect(create).toHaveBeenCalledOnce());
        if (action === "archive")
          archiveThreadAndHiddenSourceForks(harness.deps, {
            thread,
            environment: null,
          });
        else cancelAbandonedProviderLaunches(harness.deps, thread.id);
        await vi.waitFor(() =>
          expect(getMachineLaunch(harness.db, key)).toMatchObject({
            phase: "cancelled",
            cancelPending: false,
          }),
        );
        expect(remove).toHaveBeenCalledWith(
          expect.objectContaining({ hostId: newHost.id, resource: { key } }),
        );
        expect(getMachineLaunch(harness.db, thread.id)).toMatchObject({
          phase: "ready",
          hostId: oldHost.id,
        });
        expect(getHost(harness.db, newHost.id)?.phase).toBe("destroyed");
        expect(create).toHaveBeenCalledOnce();
      }),
  );

  it("cancels a pending machine creation when its thread is deleted", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host_deleted_launch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/deleted-machine-launch",
      });
      const thread = seedThread(harness.deps, {
        environmentId: null,
        projectId: project.id,
        status: "starting",
      });
      const calls: string[] = [];
      const record = installMachineProvider(
        machineDeclaration(host.id, {
          create: ({ key, signal }) =>
            new Promise((_resolve, reject) => {
              calls.push(`create:${key}`);
              const row = getMachineLaunch(harness.db, key);
              if (row === null) throw new Error("Missing launch");
              updateMachineLaunchAttempt(harness.db, {
                ...row,
                hostId: host.id,
              });
              signal.addEventListener(
                "abort",
                () => reject(new Error("aborted")),
                { once: true },
              );
            }),
          reconcileCleanup: async ({ key }) => {
            calls.push(`reconcile:${key}`);
            return { status: "removed" };
          },
        }),
      );
      askMachineLaunch(harness.deps, { key: thread.id, record, inputs: null });
      await vi.waitFor(() => {
        expect(calls).toEqual([`create:${thread.id}`]);
      });

      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}`,
        {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ childThreadsConfirmed: false }),
        },
      );
      expect(response.status).toBe(200);
      await vi.waitFor(() => {
        expect(calls).toEqual([
          `create:${thread.id}`,
          `reconcile:${thread.id}`,
        ]);
      });
      await vi.waitFor(() => {
        expect(getMachineLaunch(harness.db, thread.id)).toMatchObject({
          phase: "cancelled",
          cancelPending: false,
        });
        expect(getHost(harness.db, host.id)).toMatchObject({
          destroyedAt: expect.any(Number),
          phase: "destroyed",
        });
      });
    }));

  it("suspends when requested by the provider", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host } = seedHostSession(harness.deps, { id: "host_suspend" });
      const { project, environment } = seedMachineWorkspace(
        harness,
        host.id,
        "/tmp/suspend",
      );
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      let suspends = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async () => {
            suspends += 1;
            return { resource: { snapshot: "snap-1" } };
          },
          resume: async ({ resource }) => ({ resource }),
        }),
      );
      adoptMachine(harness, host.id);

      await requestMachineSuspension(harness.deps, host.id);
      expect(suspends).toBe(1);
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "suspended",
        suspendedAt: 10_000,
        resource: { snapshot: "snap-1" },
      });
    }));

  it("waits for the daemon session to close before invoking suspend", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host, session } = seedHostSession(harness.deps, {
        id: "host_suspend_rpc",
      });
      harness.hub.unregisterDaemon(session.id);
      const sent: string[] = [];
      harness.hub.registerDaemon(session.id, host.id, {
        close() {},
        send(data) {
          sent.push(data);
        },
      });
      const { project, environment } = seedMachineWorkspace(
        harness,
        host.id,
        "/tmp/suspend-rpc",
      );
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      let providerCalled = false;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ resource }) => {
            providerCalled = true;
            expect(harness.hub.hasDaemonForHost(host.id)).toBe(false);
            return { resource };
          },
          resume: async ({ resource }) => ({ resource }),
        }),
      );
      adoptMachine(harness, host.id);

      const suspension = requestMachineSuspension(harness.deps, host.id);
      await vi.waitFor(() => {
        expect(sent).toContain(JSON.stringify({ type: "machine.shutdown" }));
      });
      expect(providerCalled).toBe(false);
      harness.hub.unregisterDaemon(session.id);
      await suspension;
      expect(providerCalled).toBe(true);
      expect(harness.hub.hasDaemonForHost(host.id)).toBe(false);
    }));

  it("persists a suspension checkpoint even when the provider crashes afterward", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host, session } = seedHostSession(harness.deps, {
        id: "host_suspend_checkpoint",
      });
      const socket = registerTestHostRpcCapture(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { project, environment } = seedMachineWorkspace(
        harness,
        host.id,
        "/tmp/suspend-checkpoint",
      );
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      let resumes = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async (context) => {
            await context.checkpoint({ snapshot: "snap-recoverable" });
            harness.hub.unregisterDaemon(session.id);
            throw new Error("server crashed after checkpoint");
          },
          resume: async ({ resource }) => {
            resumes += 1;
            harness.hub.registerDaemon(session.id, host.id, socket);
            const checkpoint = z
              .object({ snapshot: z.string() })
              .strict()
              .parse(resource);
            return { resource: { ...checkpoint, recovered: true } };
          },
        }),
      );
      adoptMachine(harness, host.id, { sandbox: "live" });

      await expect(
        requestMachineSuspension(harness.deps, host.id),
      ).rejects.toThrow("server crashed after checkpoint");
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "suspended",
        resource: { snapshot: "snap-recoverable" },
        suspendMessage: expect.stringContaining(
          "server crashed after checkpoint",
        ),
        suspendRetryAt: expect.any(Number),
      });
      harness.db
        .update(threads)
        .set({ status: "error", updatedAt: 10_001 })
        .where(eq(threads.id, thread.id))
        .run();

      await expect(
        ensureHostSessionReadyForWork(harness.deps, { hostId: host.id }),
      ).resolves.toMatchObject({ hostId: host.id });
      expect(resumes).toBe(1);
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "active",
        resource: { snapshot: "snap-recoverable", recovered: true },
      });
      updateHost(harness.db, harness.hub, host.id, {
        phase: "suspending",
        resource: { snapshot: "snap-sweep-recovery" },
      });
      harness.hub.unregisterDaemon(session.id);

      await sweepProviderMachine(harness.deps, host.id);
      expect(resumes).toBe(2);
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "active",
        resource: { snapshot: "snap-sweep-recovery", recovered: true },
      });
    }));

  it("recovers a persisted suspending machine from its surviving resource", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host_surviving_suspend",
      });
      const resources: JsonValue[] = [];
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ resource }) => ({ resource }),
          resume: async ({ resource }) => {
            resources.push(resource);
            return { resource: { sandbox: "surviving", resumed: true } };
          },
        }),
      );
      adoptMachine(harness, host.id, {
        sandbox: "surviving",
        snapshot: null,
      });
      updateHost(harness.db, harness.hub, host.id, {
        phase: "suspending",
      });

      await sweepProviderMachine(harness.deps, host.id);

      expect(resources).toEqual([{ sandbox: "surviving", snapshot: null }]);
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "active",
        resource: { sandbox: "surviving", resumed: true },
      });
    }));

  it("serializes removal after an in-flight suspension", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host } = seedHostSession(harness.deps, {
        id: "host_suspend_remove",
      });
      const { project, environment } = seedMachineWorkspace(
        harness,
        host.id,
        "/tmp/suspend-remove",
      );
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      const suspendStarted = createDeferredPromise<void>();
      const suspendRelease = createDeferredPromise<void>();
      const removeStarted = createDeferredPromise<void>();
      const removedResources: JsonValue[] = [];
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async () => {
            suspendStarted.resolve();
            await suspendRelease.promise;
            return { resource: { snapshot: "snap-before-remove" } };
          },
          resume: async ({ resource }) => ({ resource }),
          remove: async ({ resource }) => {
            removedResources.push(resource);
            removeStarted.resolve();
            return { status: "removed" };
          },
        }),
      );
      adoptMachine(harness, host.id, { sandbox: "live" });

      const suspendSweep = requestMachineSuspension(harness.deps, host.id);
      await suspendStarted.promise;
      harness.db
        .update(threads)
        .set({ archivedAt: 10_000 })
        .where(eq(threads.id, thread.id))
        .run();
      expect(requestMachineRemoval(harness.deps, host.id)).toBe(true);
      const removalSweep = sweepProviderMachine(harness.deps, host.id);
      const order = await Promise.race([
        removeStarted.promise.then(() => "removed" as const),
        new Promise<"waiting">((resolve) =>
          setImmediate(() => resolve("waiting")),
        ),
      ]);
      suspendRelease.resolve();
      await Promise.all([suspendSweep, removalSweep]);

      expect(order).toBe("waiting");
      expect(removedResources).toEqual([{ snapshot: "snap-before-remove" }]);
      expect(getHost(harness.db, host.id)).toMatchObject({
        destroyedAt: expect.any(Number),
        phase: "destroyed",
        resource: null,
        teardownStatus: "removed",
      });
    }));

  it("ignores a suspension result that finishes after the machine was destroyed", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host } = seedHostSession(harness.deps, {
        id: "host_stale_suspend_completion",
      });
      const { project, environment } = seedMachineWorkspace(
        harness,
        host.id,
        "/tmp/stale-suspend-completion",
      );
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      const suspendStarted = createDeferredPromise<void>();
      const suspendRelease = createDeferredPromise<void>();
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async () => {
            suspendStarted.resolve();
            await suspendRelease.promise;
            return { resource: { snapshot: "stale-snapshot" } };
          },
          resume: async ({ resource }) => ({ resource }),
        }),
      );
      adoptMachine(harness, host.id, { sandbox: "live" });

      const suspendSweep = requestMachineSuspension(harness.deps, host.id);
      await suspendStarted.promise;
      updateHost(harness.db, harness.hub, host.id, {
        destroyedAt: 10_000,
        phase: "destroyed",
        resource: null,
        suspendedAt: null,
        teardownStatus: "removed",
      });
      suspendRelease.resolve();
      await suspendSweep;

      expect(getHost(harness.db, host.id)).toMatchObject({
        destroyedAt: 10_000,
        phase: "destroyed",
        resource: null,
        suspendedAt: null,
        teardownStatus: "removed",
      });
    }));

  it("scheduled resume is idempotent when active and waits for manual snapshot suspension", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host_scheduled_wake",
      });
      const entered = createDeferredPromise<void>();
      const finish = createDeferredPromise<void>();
      let resumes = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async () => {
            entered.resolve();
            await finish.promise;
            return { resource: { snapshot: "fresh" } };
          },
          resume: async () => {
            resumes += 1;
            return { resource: { snapshot: "fresh" } };
          },
        }),
      );
      adoptMachine(harness, host.id, { sandbox: "live" });
      await requestMachineResume(harness.deps, host.id);
      expect(resumes).toBe(0);
      const sleeping = requestMachineSuspension(harness.deps, host.id);
      await entered.promise;
      let completed = false;
      const waking = requestMachineResume(harness.deps, host.id).then(() => {
        completed = true;
      });
      await Promise.resolve();
      expect(completed).toBe(false);
      expect(resumes).toBe(0);
      finish.resolve();
      await Promise.all([sleeping, waking]);
      expect(resumes).toBe(1);
      expect(getHost(harness.db, host.id)?.phase).toBe("active");
      await requestMachineResume(harness.deps, host.id);
      expect(resumes).toBe(1);
    }));

  it("waits for an in-flight suspension and resumes before dispatching new work", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host, session } = seedHostSession(harness.deps, {
        id: "host_suspend_race",
      });
      const socket = registerTestHostRpcCapture(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { project, environment } = seedMachineWorkspace(
        harness,
        host.id,
        "/tmp/suspend-race",
      );
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      const suspendStarted = createDeferredPromise<void>();
      const suspendRelease = createDeferredPromise<void>();
      let resumes = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async () => {
            suspendStarted.resolve();
            await suspendRelease.promise;
            return { resource: { snapshot: "snap-race" } };
          },
          resume: async () => {
            resumes += 1;
            harness.hub.registerDaemon(session.id, host.id, socket);
            return { resource: { sandbox: "resumed" } };
          },
        }),
      );
      adoptMachine(harness, host.id, { sandbox: "live" });

      const sweep = requestMachineSuspension(harness.deps, host.id);
      await suspendStarted.promise;
      let dispatched = false;
      const admission = ensureHostSessionReadyForWork(harness.deps, {
        hostId: host.id,
      }).then(() => {
        dispatched = true;
      });
      await Promise.resolve();
      expect(dispatched).toBe(false);
      suspendRelease.resolve();

      await Promise.all([sweep, admission]);
      expect(resumes).toBe(1);
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "active",
        suspendedAt: null,
        resource: { sandbox: "resumed" },
      });
    }));

  it("resumes an owned workspace without rerunning setup or preflight when a message is sent", async () =>
    withTestHarness(async (harness) => {
      const { host, session } = seedHostSession(harness.deps, {
        id: "host_resume",
      });
      const socket = registerTestHostRpcCapture(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { project, environment } = seedMachineWorkspace(
        harness,
        host.id,
        "/tmp/resume",
      );
      harness.db
        .update(environments)
        .set({ providerOwnsPath: true })
        .where(eq(environments.id, environment.id))
        .run();
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      seedThreadRuntimeState(harness.deps, {
        environmentId: environment.id,
        providerThreadId: "provider-resume",
        threadId: thread.id,
      });
      let resumes = 0;
      let observedProgress: string | null = null;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ resource }) => ({ resource }),
          resume: async ({ report }) => {
            resumes += 1;
            report.step("Restoring the test machine…");
            const hosts = hostSchema
              .array()
              .parse(await (await harness.app.request("/api/v1/hosts")).json());
            observedProgress =
              hosts.find((candidate) => candidate.id === host.id)?.lifecycle
                .progress ?? null;
            harness.hub.registerDaemon(session.id, host.id, socket);
            return { resource: { sandbox: "resumed" } };
          },
        }),
      );
      adoptMachine(harness, host.id, { snapshot: "snap-1" });
      updateHost(harness.db, harness.hub, host.id, {
        phase: "suspended",
        suspendedAt: Date.now(),
      });
      harness.hub.unregisterDaemon(session.id);

      await expect(
        sendThreadMessage(harness.deps, {
          environment,
          payload: {
            input: textInput("resume this machine"),
            mode: "start",
            model: "gpt-5",
            permissionMode: "full",
            reasoningLevel: "medium",
            serviceTier: "default",
          },
          thread,
          trigger: "user",
        }),
      ).resolves.toBeUndefined();
      expect(harness.db.select().from(environmentHookOperations).all()).toEqual(
        [],
      );
      expect(resumes).toBe(1);
      expect(observedProgress).toBe("Restoring the test machine…");
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "active",
        suspendedAt: null,
        resource: { sandbox: "resumed" },
      });
    }));

  it("explicit removal cascades environment removal first", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const { host } = seedHostSession(harness.deps, { id: "host_retire" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/retire",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/retire",
        providerOwnsPath: true,
        status: "ready",
        environmentProvider: {
          pluginId: "test-environment-plugin",
          environmentProviderId: "test-environment",
          instanceKey: "retire-environment",
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ archivedAt: 20_000 })
        .where(eq(threads.id, thread.id))
        .run();
      const order: string[] = [];
      const environmentProvider = validatePluginEnvironmentProviderDeclaration({
        id: "test-environment",
        displayName: "Test environment",
        create: async () => ({
          status: "created",
          path: "/tmp/retire",
          ownsPath: true,
        }),
        remove: async () => {
          order.push("environment");
          return { status: "removed" };
        },
      });
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [
          {
            pluginId: "test-environment-plugin",
            provider: environmentProvider,
          },
        ],
        getEnvironmentProvider: (id) =>
          id === environmentProvider.id
            ? {
                pluginId: "test-environment-plugin",
                provider: environmentProvider,
              }
            : undefined,
        invokeProvider: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      installMachineProvider(
        machineDeclaration(host.id, {
          remove: async () => {
            order.push("machine");
            return { status: "removed" };
          },
        }),
      );
      adoptMachine(harness, host.id);

      requestMachineRemoval(harness.deps, host.id);
      await sweepProviderMachine(harness.deps, host.id);
      expect(order).toEqual(["environment", "machine"]);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
        teardownStatus: "removed",
      });
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it("resumes a suspended removing machine for its environment cascade without clearing removal", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const { host, session } = seedHostSession(harness.deps, {
        id: "host_suspended_retire",
      });
      const socket = registerTestHostRpcCapture(harness.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/suspended-retire",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/suspended-retire",
        providerOwnsPath: true,
        status: "ready",
        environmentProvider: {
          pluginId: "test-environment-plugin",
          environmentProviderId: "test-environment",
          instanceKey: "suspended-retire-environment",
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ archivedAt: 20_000 })
        .where(eq(threads.id, thread.id))
        .run();
      let environmentRemovalPhase: string | null = null;
      const environmentProvider = validatePluginEnvironmentProviderDeclaration({
        id: "test-environment",
        displayName: "Test environment",
        create: async () => ({
          status: "created",
          path: "/tmp/suspended-retire",
          ownsPath: true,
        }),
        remove: async () => {
          environmentRemovalPhase = getHost(harness.db, host.id)?.phase ?? null;
          return harness.hub.hasDaemonForHost(host.id)
            ? { status: "removed" }
            : { status: "failed", message: "Host is not connected" };
        },
      });
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [
          {
            pluginId: "test-environment-plugin",
            provider: environmentProvider,
          },
        ],
        getEnvironmentProvider: (id) =>
          id === environmentProvider.id
            ? {
                pluginId: "test-environment-plugin",
                provider: environmentProvider,
              }
            : undefined,
        invokeProvider: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      let removes = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ resource }) => ({ resource }),
          resume: async () => {
            harness.hub.registerDaemon(session.id, host.id, socket);
            return {
              resource: { snapshot: "snap-retire", resumed: true },
            };
          },
          remove: async () => {
            removes += 1;
            return { status: "removed" };
          },
        }),
      );
      adoptMachine(harness, host.id, { snapshot: "snap-retire" });
      updateHost(harness.db, harness.hub, host.id, {
        phase: "suspended",
        suspendedAt: 19_000,
      });
      harness.hub.unregisterDaemon(session.id);

      requestMachineRemoval(harness.deps, host.id);
      await sweepProviderMachine(harness.deps, host.id);
      expect(environmentRemovalPhase).toBe("removing");
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
        teardownStatus: "removed",
      });
      expect(removes).toBe(1);
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it("removes a suspended removing machine directly when no environment needs cleanup", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const { host, session } = seedHostSession(harness.deps, {
        id: "host_suspended_retire_without_environment",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/retire-without-host-cleanup",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/retire-without-host-cleanup",
        providerOwnsPath: false,
        status: "ready",
        environmentProvider: {
          pluginId: "test-attached-environment-plugin",
          environmentProviderId: "test-attached-environment",
          instanceKey: "attached-environment",
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
      });
      let environmentRemoves = 0;
      const environmentProvider = validatePluginEnvironmentProviderDeclaration({
        id: "test-attached-environment",
        displayName: "Test attached environment",
        create: async () => ({
          status: "created",
          path: "/tmp/retire-without-host-cleanup",
          ownsPath: false,
        }),
        remove: async () => {
          environmentRemoves += 1;
          return { status: "removed" };
        },
      });
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [
          {
            pluginId: "test-attached-environment-plugin",
            provider: environmentProvider,
          },
        ],
        getEnvironmentProvider: (id) =>
          id === environmentProvider.id
            ? {
                pluginId: "test-attached-environment-plugin",
                provider: environmentProvider,
              }
            : undefined,
        invokeProvider: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      let resumes = 0;
      let removes = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ resource }) => ({ resource }),
          resume: async () => {
            resumes += 1;
            throw new Error("snapshot restoration has no capacity");
          },
          remove: async () => {
            removes += 1;
            return { status: "removed" };
          },
        }),
      );
      adoptMachine(harness, host.id, { snapshot: "snap-remove-directly" });
      updateHost(harness.db, harness.hub, host.id, {
        phase: "suspended",
        suspendedAt: 19_000,
      });
      harness.hub.unregisterDaemon(session.id);

      requestMachineRemoval(harness.deps, host.id);
      await expect(
        sweepProviderMachine(harness.deps, host.id),
      ).resolves.toBeUndefined();

      expect(resumes).toBe(0);
      expect(environmentRemoves).toBe(1);
      expect(removes).toBe(1);
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
      });
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it("sweeps removal without invoking provider pause", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(30_000);
      const { host: failingHost } = seedHostSession(harness.deps, {
        id: "host_a_failing_suspend",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: failingHost.id,
        path: "/tmp/failing-suspend",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: failingHost.id,
        path: "/tmp/failing-suspend",
        providerOwnsPath: false,
        status: "ready",
        environmentProvider: null,
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      const { host: removableHost } = seedHostSession(harness.deps, {
        id: "host_b_removable",
      });
      let removes = 0;
      installMachineProvider(
        machineDeclaration(failingHost.id, {
          suspend: async ({ hostId, resource }) => {
            if (hostId === failingHost.id) {
              throw new Error("snapshot service unavailable");
            }
            return { resource };
          },
          resume: async ({ resource }) => ({ resource }),
          remove: async () => {
            removes += 1;
            return { status: "removed" };
          },
        }),
      );
      adoptMachine(harness, failingHost.id);
      adoptMachine(harness, removableHost.id);
      expect(requestMachineRemoval(harness.deps, removableHost.id)).toBe(true);

      await expect(
        sweepMachineLifecycles(harness.deps),
      ).resolves.toBeUndefined();
      expect(getHost(harness.db, failingHost.id)).toMatchObject({
        phase: "active",
        teardownStatus: null,
        teardownMessage: null,
      });
      expect(removes).toBe(1);
      expect(getHost(harness.db, removableHost.id)).toMatchObject({
        phase: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it("keeps an unused machine until the user removes it", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, { id: "host_never" });
      let removes = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          remove: async () => {
            removes += 1;
            return { status: "removed" };
          },
        }),
      );
      adoptMachine(harness, host.id);

      await sweepProviderMachine(harness.deps, host.id);
      expect(removes).toBe(0);
      expect(getHost(harness.db, host.id)?.phase).toBe("active");
      expect(requestMachineRemoval(harness.deps, host.id)).toBe(true);
      await sweepProviderMachine(harness.deps, host.id);
      expect(removes).toBe(1);
      expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
    }));

  it("automatically removes an ephemeral machine when its last environment retires", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host_ephemeral_retired",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/ephemeral-retired",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/ephemeral-retired",
        providerOwnsPath: false,
        status: "ready",
        environmentProvider: {
          pluginId: "test-environment-plugin",
          environmentProviderId: "test-environment",
          instanceKey: "ephemeral-retired",
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
      });
      const environmentRemove = vi.fn(async () => ({
        status: "removed" as const,
      }));
      const environmentProvider = validatePluginEnvironmentProviderDeclaration({
        id: "test-environment",
        displayName: "Test environment",
        policy: { retireGraceMs: 0 },
        create: async () => ({
          status: "created",
          path: "/tmp/ephemeral-retired",
          ownsPath: false,
        }),
        remove: environmentRemove,
      });
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [
          {
            pluginId: "test-environment-plugin",
            provider: environmentProvider,
          },
        ],
        getEnvironmentProvider: (id) =>
          id === environmentProvider.id
            ? {
                pluginId: "test-environment-plugin",
                provider: environmentProvider,
              }
            : undefined,
        invokeProvider: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      const machineRemove = vi.fn(async () => ({
        status: "removed" as const,
      }));
      installMachineProvider(
        machineDeclaration(host.id, {
          ephemeral: true,
          remove: machineRemove,
        }),
      );
      adoptMachine(harness, host.id, undefined, "ephemeral");

      await sweepProviderEnvironment(harness.deps, environment.id);

      expect(environmentRemove).toHaveBeenCalledOnce();
      expect(getEnvironment(harness.db, environment.id)).toMatchObject({
        status: "destroyed",
        teardownStatus: "removed",
      });
      expect(machineRemove).toHaveBeenCalledOnce();
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it.each([
    { blocker: "a live thread", environmentStatus: "destroyed" as const },
    { blocker: "a ready environment", environmentStatus: "ready" as const },
  ])(
    "does not automatically remove an ephemeral machine with $blocker",
    async ({ environmentStatus }) =>
      withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, {
          id: `host_blocked_${environmentStatus}`,
        });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
          path: `/tmp/blocked-${environmentStatus}`,
        });
        const environment = createEnvironment(harness.db, harness.hub, {
          projectId: project.id,
          hostId: host.id,
          path: `/tmp/blocked-${environmentStatus}`,
          providerOwnsPath: false,
          status: environmentStatus,
          environmentProvider: null,
        });
        if (environmentStatus === "destroyed") {
          seedThread(harness.deps, {
            projectId: project.id,
            environmentId: environment.id,
            status: "idle",
          });
        }
        const remove = vi.fn(async () => ({ status: "removed" as const }));
        installMachineProvider(
          machineDeclaration(host.id, {
            ephemeral: true,
            remove,
          }),
        );
        adoptMachine(harness, host.id, undefined, "ephemeral");

        await sweepMachineLifecycles(harness.deps);

        expect(remove).not.toHaveBeenCalled();
        expect(getHost(harness.db, host.id)?.phase).toBe("active");
      }),
  );

  it("keeps an ephemeral machine while a live thread needs its ready launch", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host_live_launch",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/live-launch",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        status: "starting",
      });
      seedReadyLaunch(harness, { key: thread.id, hostId: host.id });
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      installMachineProvider(
        machineDeclaration(host.id, {
          ephemeral: true,
          remove,
        }),
      );
      adoptMachine(harness, host.id, undefined, "ephemeral");

      await sweepMachineLifecycles(harness.deps);

      expect(remove).not.toHaveBeenCalled();
      expect(getHost(harness.db, host.id)?.phase).toBe("active");
    }));

  it("never automatically removes a manually enrolled machine", async () =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: "host_manually_enrolled",
      });
      const remove = vi.fn(async () => ({ status: "removed" as const }));
      installMachineProvider(
        machineDeclaration(host.id, {
          ephemeral: true,
          remove,
        }),
      );

      await sweepMachineLifecycles(harness.deps);

      expect(remove).not.toHaveBeenCalled();
      expect(getHost(harness.db, host.id)).toMatchObject({
        machineProviderId: null,
        destroyedAt: null,
      });
    }));

  it("retries failed automatic provider removal at removeRetryAt", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const { host } = seedHostSession(harness.deps, {
        id: "host_ephemeral_retry",
      });
      const remove = vi
        .fn()
        .mockResolvedValueOnce({
          status: "failed" as const,
          message: "vendor rate limit",
        })
        .mockResolvedValueOnce({ status: "removed" as const });
      installMachineProvider(
        machineDeclaration(host.id, {
          ephemeral: true,
          remove,
        }),
      );
      adoptMachine(harness, host.id, undefined, "ephemeral");

      await sweepMachineLifecycles(harness.deps);
      expect(remove).toHaveBeenCalledOnce();
      expect(getHost(harness.db, host.id)).toMatchObject({
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
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "destroyed",
        teardownStatus: "removed",
      });
    }));

  it("removes destroyed-machine project sources and selects a surviving default", async () =>
    withTestHarness(async (harness) => {
      const { host: removedHost } = seedHostSession(harness.deps, {
        id: "host_removed_source",
      });
      const { host: survivingHost } = seedHostSession(harness.deps, {
        id: "host_surviving_source",
      });
      const { project, source: removedSource } = seedProjectWithSource(
        harness.deps,
        {
          hostId: removedHost.id,
          path: "/tmp/removed-source",
        },
      );
      const survivingSource = createProjectSource(harness.db, harness.hub, {
        projectId: project.id,
        hostId: survivingHost.id,
        path: "/tmp/surviving-source",
        type: "local_path",
      });
      installMachineProvider(machineDeclaration(removedHost.id));
      adoptMachine(harness, removedHost.id);

      expect(requestMachineRemoval(harness.deps, removedHost.id)).toBe(true);
      await sweepProviderMachine(harness.deps, removedHost.id);

      expect(listProjectSourcesByProjectIds(harness.db, [project.id])).toEqual([
        expect.objectContaining({
          id: survivingSource.id,
          hostId: survivingHost.id,
          isDefault: true,
        }),
      ]);
      expect(getDefaultProjectSource(harness.db, project.id)?.id).toBe(
        survivingSource.id,
      );
      expect(
        listProjectSourcesByProjectIds(harness.db, [project.id]).some(
          (source) => source.id === removedSource.id,
        ),
      ).toBe(false);
    }));
});

describe("machine lifecycle safety regressions", () => {
  it("archived stopping thread blocks idle suspension", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host } = seedHostSession(harness.deps, { id: "host_suspend" });
      const { project, environment } = seedMachineWorkspace(
        harness,
        host.id,
        "/tmp/suspend",
      );
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ updatedAt: 1_000 })
        .where(eq(threads.id, thread.id))
        .run();
      const busy = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "stopping",
      });
      harness.db
        .update(threads)
        .set({ archivedAt: 9_000 })
        .where(eq(threads.id, busy.id))
        .run();
      let suspends = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async () => {
            suspends += 1;
            return { resource: { snapshot: "snap-1" } };
          },
          resume: async ({ resource }) => ({ resource }),
        }),
      );
      adoptMachine(harness, host.id);

      await sweepProviderMachine(harness.deps, host.id);
      expect(suspends).toBe(0);
    }));

  it("restoring during machine removal preserves the durable claim and requires replacement", async () =>
    withTestHarness(async (harness) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(20_000);
      const { host } = seedHostSession(harness.deps, { id: "host_retire" });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: host.id,
        path: "/tmp/retire",
      });
      const environment = createEnvironment(harness.db, harness.hub, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/retire",
        providerOwnsPath: true,
        status: "ready",
        environmentProvider: {
          pluginId: "test-environment-plugin",
          environmentProviderId: "test-environment",
          instanceKey: "retire-environment",
          selection: {
            machine: { type: "existing", hostId: host.id },
            inputs: null,
          },
        },
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "idle",
      });
      harness.db
        .update(threads)
        .set({ archivedAt: 20_000 })
        .where(eq(threads.id, thread.id))
        .run();
      const order: string[] = [];
      const cleanupStarted = createDeferredPromise<void>();
      const cleanupRelease = createDeferredPromise<void>();
      const environmentProvider = validatePluginEnvironmentProviderDeclaration({
        id: "test-environment",
        displayName: "Test environment",
        create: async () => ({
          status: "created",
          path: "/tmp/retire",
          ownsPath: true,
        }),
        remove: async () => {
          order.push("environment");
          return { status: "removed" };
        },
      });
      setPluginEnvironmentProviderBridge({
        listEnvironmentProviders: () => [
          {
            pluginId: "test-environment-plugin",
            provider: environmentProvider,
          },
        ],
        getEnvironmentProvider: (id) =>
          id === environmentProvider.id
            ? {
                pluginId: "test-environment-plugin",
                provider: environmentProvider,
              }
            : undefined,
        invokeProvider: async (_pluginId, _label, run) => ({
          ok: true,
          value: await run(),
        }),
        decisionTimeoutMs: 10_000,
      });
      installMachineProvider(
        machineDeclaration(host.id, {
          remove: async () => {
            order.push("machine");
            cleanupStarted.resolve();
            await cleanupRelease.promise;
            return { status: "removed" };
          },
        }),
      );
      adoptMachine(harness, host.id);

      vi.setSystemTime(25_001);
      requestMachineRemoval(harness.deps, host.id);
      const removing = sweepProviderMachine(harness.deps, host.id);
      await cleanupStarted.promise;
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}/unarchive`,
        { method: "POST" },
      );
      expect(response.status).toBe(200);
      await sweepProviderMachine(harness.deps, host.id);
      expect(getHost(harness.db, host.id)).toMatchObject({
        phase: "removing",
        teardownStatus: "running",
        removalStartedAt: 25_001,
      });
      await expect(
        ensureHostSessionReadyForWork(harness.deps, { hostId: host.id }),
      ).rejects.toThrow("Machine removal has begun");
      seedReadyLaunch(harness, { key: thread.id, hostId: host.id });
      expect(resolveThreadMachineLaunchKey(harness.deps, thread.id)).toBe(
        thread.id + ":replacement:" + host.id,
      );
      cleanupRelease.resolve();
      await removing;
      expect(getHost(harness.db, host.id)?.phase).toBe("destroyed");
    }));
});

it("cancelled launch cleanup persists and honors core retry timing", async () =>
  withTestHarness(async (harness) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(20000);
    const { host } = seedHostSession(harness.deps, {
      id: "host_cleanup_backoff",
    });
    let removes = 0;
    installMachineProvider(
      machineDeclaration(host.id, {
        remove: async () => {
          removes++;
          return { status: "failed", message: "vendor rate limit" };
        },
      }),
    );
    seedReadyLaunch(harness, { key: "failed-cleanup", hostId: host.id });
    const launch = getMachineLaunch(harness.db, "failed-cleanup")!;
    updateMachineLaunchAttempt(harness.db, {
      ...launch,
      phase: "cancelled",
      cancelPending: true,
      cleanupResourceRemoved: false,
    });
    for (let n = 0; n < 3; n++) await sweepMachineLifecycles(harness.deps);
    expect(removes).toBe(1);
    expect(getMachineLaunch(harness.db, "failed-cleanup")?.cleanupRetryAt).toBe(
      80000,
    );
    vi.setSystemTime(79999);
    await sweepMachineLifecycles(harness.deps);
    expect(removes).toBe(1);
    vi.setSystemTime(80000);
    await sweepMachineLifecycles(harness.deps);
    expect(removes).toBe(2);
  }));

it("cancel before allocation reconciles without starting a fresh allocation", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, {
      id: "host_cancel_before_alloc",
    });
    const started = createDeferredPromise<void>();
    let creates = 0;
    let allocations = 0;
    const record = installMachineProvider(
      machineDeclaration(host.id, {
        create: async ({ signal }) => {
          creates++;
          if (creates === 1) {
            started.resolve();
            await new Promise<void>((resolve) =>
              signal.addEventListener("abort", () => resolve(), { once: true }),
            );
            signal.throwIfAborted();
          }
          allocations++;
          return {
            status: "created",
            name: "Test machine",
            resource: { allocated: true },
          };
        },
      }),
    );
    askMachineLaunch(harness.deps, {
      key: "cancel-before-allocation",
      record,
      inputs: null,
    });
    await started.promise;
    await cancelMachineLaunch(harness.deps, "cancel-before-allocation");
    expect(allocations).toBe(0);
    expect(creates).toBe(1);
    expect(
      getMachineLaunch(harness.db, "cancel-before-allocation"),
    ).toMatchObject({ cancelPending: false, cleanupResourceRemoved: true });
  }));

it("retains a persisted removal claim after restart even when live work is restored", async () =>
  withTestHarness(async (harness) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(20_000);
    const { host } = seedHostSession(harness.deps, {
      id: "claimed-after-restart",
    });
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
      path: "/tmp/claimed",
    });
    const environment = createEnvironment(harness.db, harness.hub, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/claimed",
      providerOwnsPath: false,
      status: "ready",
      environmentProvider: null,
    });
    seedThread(harness.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "idle",
    });
    const remove = vi.fn(async () => ({ status: "removed" as const }));
    installMachineProvider(machineDeclaration(host.id, { remove }));
    adoptMachine(harness, host.id);
    updateHost(harness.db, harness.hub, host.id, {
      phase: "removing",
      removalStartedAt: 10_000,
      removeRetryAt: 20_001,
      teardownStatus: "failed",
    });
    await sweepProviderMachine(harness.deps, host.id);
    expect(remove).not.toHaveBeenCalled();
    await expect(
      ensureHostSessionReadyForWork(harness.deps, { hostId: host.id }),
    ).rejects.toThrow("Machine removal has begun");
    vi.setSystemTime(20_001);
    await sweepProviderMachine(harness.deps, host.id);
    expect(remove).toHaveBeenCalledOnce();
    expect(getHost(harness.db, host.id)).toMatchObject({
      phase: "destroyed",
      removalStartedAt: 10_000,
    });
  }));

it("returns a durable launch before allocation and client disconnect does not cancel", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, {
      id: "durable-disconnect",
    });
    const release = createDeferredPromise<void>();
    let providerSignal: AbortSignal | undefined;
    installMachineProvider(
      machineDeclaration(host.id, {
        create: async ({ key, signal }) => {
          providerSignal = signal;
          reserveLaunchHost(harness, key, host.id);
          await release.promise;
          return {
            status: "created",
            name: "Test machine",
            resource: { allocated: true },
          };
        },
      }),
    );
    const controller = new AbortController();
    const response = await harness.app.request("/api/v1/hosts", {
      method: "POST",
      signal: controller.signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        key: "disconnect",
        machineProviderId: "test-machine",
        inputs: null,
      }),
    });
    expect(response.status).toBe(201);
    expect(await response.json()).toMatchObject({
      id: "disconnect",
      phase: "creating",
    });
    controller.abort();
    expect(providerSignal?.aborted).toBe(false);
    release.resolve();
    await expect
      .poll(() => getMachineLaunch(harness.db, "disconnect")?.phase)
      .toBe("ready");
    const status = await harness.app.request(
      "/api/v1/hosts/launches/disconnect",
    );
    expect(await status.json()).toMatchObject({
      phase: "ready",
      hostId: host.id,
    });
  }));

it("explicit cancel settles enrollment, tombstones pending hosts and aborts creation", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "explicit-cancel" });
    seedPendingEnrollment(harness, host.id, "explicit-cancel");
    const started = createDeferredPromise<void>();
    installMachineProvider(
      machineDeclaration(host.id, {
        create: async ({ key, signal }) => {
          updateMachineLaunchAttempt(harness.db, {
            key,
            attempt: 1,
            hostId: host.id,
          });
          started.resolve();
          await new Promise<void>((resolve) =>
            signal.addEventListener("abort", () => resolve(), { once: true }),
          );
          signal.throwIfAborted();
          throw new Error("unreachable");
        },
      }),
    );
    await submitMachine(harness.deps, {
      key: "explicit-cancel",
      machineProviderId: "test-machine",
      inputs: null,
    });
    await started.promise;
    vi.spyOn(serverAccess, "release").mockImplementation(async () => {
      expect(
        (await harness.app.request(`/api/v1/hosts/${host.id}`)).status,
      ).toBe(200);
    });
    const response = await harness.app.request(
      "/api/v1/hosts/launches/explicit-cancel/cancel",
      { method: "POST" },
    );
    expect(await response.json()).toMatchObject({
      phase: "cancelled",
      cancelPending: false,
    });
    expectSettledEnrollment(harness, host.id);
    expect((await harness.app.request(`/api/v1/hosts/${host.id}`)).status).toBe(
      404,
    );
  }));

function seedPendingEnrollment(
  harness: TestAppHarness,
  hostId: string,
  key: string,
): void {
  harness.db
    .insert(machineEnrollments)
    .values({
      id: `enroll-${key}`,
      owner: "test-plugin",
      key,
      hostId,
      state: "pending",
      encryptedBootstrap: "encrypted-fixture",

      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    .run();
}

function expectSettledEnrollment(
  harness: TestAppHarness,
  hostId: string,
): void {
  expect(
    harness.db
      .select()
      .from(machineEnrollments)
      .where(eq(machineEnrollments.hostId, hostId))
      .get(),
  ).toMatchObject({
    state: "cancelled",
    encryptedBootstrap: null,
  });
}

it("removal settles enrollment and repeating settlement is idempotent", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "remove-enrollment" });
    seedPendingEnrollment(harness, host.id, "remove-enrollment");
    installMachineProvider(machineDeclaration(host.id));
    adoptMachine(harness, host.id);
    expect(requestMachineRemoval(harness.deps, host.id)).toBe(true);
    await sweepProviderMachine(harness.deps, host.id);
    expectSettledEnrollment(harness, host.id);
    const settled = harness.db.select().from(machineEnrollments).all();
    await sweepProviderMachine(harness.deps, host.id);
    expect(harness.db.select().from(machineEnrollments).all()).toEqual(settled);
  }));

it("resume crash after checkpoint recovers the allocation and preserves one enrollment", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "resume-checkpoint" });
    seedPendingEnrollment(harness, host.id, "resume-checkpoint");
    adoptMachine(harness, host.id, { snapshot: "saved" });
    updateHost(harness.db, harness.hub, host.id, {
      phase: "suspended",
      suspendedAt: Date.now(),
    });
    let allocations = 0;
    installMachineProvider(
      machineDeclaration(host.id, {
        suspend: async ({ resource }) => ({ resource }),
        resume: async ({ resource, checkpoint }) => {
          if (allocations === 0) {
            allocations++;
            await checkpoint({ snapshot: "saved", sandbox: "restored" });
            throw new Error("crash before bootstrap");
          }
          expect(resource).toEqual({ snapshot: "saved", sandbox: "restored" });
          return { resource };
        },
      }),
    );
    await expect(resumeMachine(harness.deps, host.id)).rejects.toThrow(
      "crash before bootstrap",
    );
    const token = getHost(harness.db, host.id)?.machineOperationId;
    await resumeMachine(harness.deps, host.id);
    expect(allocations).toBe(1);
    expect(getHost(harness.db, host.id)?.machineOperationId).not.toBe(token);
    expect(getHost(harness.db, host.id)?.resource).toEqual({
      snapshot: "saved",
      sandbox: "restored",
    });
    expect(harness.db.select().from(machineEnrollments).all()).toHaveLength(1);
  }));

it.each(["owner", "operation", "removal", "phase"])(
  "rejects stale resume checkpoints and completion after competing %s",
  async (change) =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: `resume-fence-${change}`,
      });
      adoptMachine(harness, host.id, { snapshot: "saved" });
      updateHost(harness.db, harness.hub, host.id, {
        phase: "suspended",
        suspendedAt: Date.now(),
      });
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ resource }) => ({ resource }),
          resume: async ({ checkpoint }) => {
            if (change === "owner")
              updateHost(harness.db, harness.hub, host.id, {
                machineProviderId: "new-owner",
              });
            if (change === "operation")
              updateHost(harness.db, harness.hub, host.id, {
                machineOperationId: "new-operation",
              });
            if (change === "phase")
              updateHost(harness.db, harness.hub, host.id, {
                phase: "suspended",
              });
            if (change === "removal")
              requestMachineRemoval(harness.deps, host.id);
            updateHost(harness.db, harness.hub, host.id, {
              resource: { newer: true },
            });
            await expect(checkpoint({ stale: true })).rejects.toThrow(
              "no longer owns",
            );
            return { resource: { staleCompletion: true } };
          },
        }),
      );
      await resumeMachine(harness.deps, host.id);
      expect(getHost(harness.db, host.id)?.resource).toEqual({ newer: true });
    }),
);

it("bounds unresolved allocation cleanup retries and keeps the failed host tombstoned", async () =>
  withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps, { id: "bounded-reconcile" });
    seedPendingEnrollment(harness, host.id, "bounded-reconcile");
    const reconcile = vi.fn(async () => ({
      status: "failed" as const,
      message: "Allocation outcome unknown",
    }));
    installMachineProvider(
      machineDeclaration(host.id, { reconcileCleanup: reconcile }),
    );
    seedReadyLaunch(harness, { key: "bounded-reconcile", hostId: host.id });
    updateHost(harness.db, harness.hub, host.id, { machineProviderId: null });
    updateMachineLaunchAttempt(harness.db, {
      key: "bounded-reconcile",
      attempt: 1,
      phase: "failed",
      failure: "terminal",
      resource: null,
      startedAt: Date.now() - 31 * 60_000,
      cleanupResourceRemoved: false,
    });
    await expect(
      cancelMachineLaunch(harness.deps, "bounded-reconcile", true),
    ).rejects.toThrow("Allocation outcome unknown");
    for (let n = 0; n < 3; n++) await sweepMachineLifecycles(harness.deps);
    expect(reconcile).toHaveBeenCalledOnce();
    expectSettledEnrollment(harness, host.id);
    expect((await harness.app.request(`/api/v1/hosts/${host.id}`)).status).toBe(
      404,
    );
    await expect(
      cancelMachineLaunch(harness.deps, "bounded-reconcile", true, true),
    ).rejects.toThrow("Allocation outcome unknown");
    expect(reconcile).toHaveBeenCalledTimes(2);
  }));

it.each(["owner", "operation", "phase"])(
  "fences removal completion after competing %s",
  async (change) =>
    withTestHarness(async (harness) => {
      const { host } = seedHostSession(harness.deps, {
        id: `remove-fence-${change}`,
      });
      adoptMachine(harness, host.id, { allocated: true });
      installMachineProvider(
        machineDeclaration(host.id, {
          remove: async () => {
            updateHost(harness.db, harness.hub, host.id, {
              resource: { newer: true },
              ...(change === "owner" ? { machineProviderId: "new-owner" } : {}),
              ...(change === "operation"
                ? { machineOperationId: "new-operation" }
                : {}),
              ...(change === "phase" ? { phase: "active" as const } : {}),
            });
            return { status: "removed" };
          },
        }),
      );
      requestMachineRemoval(harness.deps, host.id);
      await sweepProviderMachine(harness.deps, host.id);
      expect(getHost(harness.db, host.id)).toMatchObject({
        resource: { newer: true },
        destroyedAt: null,
      });
    }),
);

it("known allocated resource keeps retrying removal after the launch window", async () =>
  withTestHarness(async (h) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(100_000);
    const { host } = seedHostSession(h.deps, { id: "review-removal-window" });
    let removes = 0;
    installMachineProvider(
      machineDeclaration(host.id, {
        remove: async () =>
          ++removes === 1
            ? { status: "failed", message: "vendor unavailable" }
            : { status: "removed" },
      }),
    );
    seedReadyLaunch(h, { key: "review-removal-window", hostId: host.id });
    updateMachineLaunchAttempt(h.db, {
      key: "review-removal-window",
      attempt: 1,
      phase: "cancelled",
      cancelPending: true,
      cleanupResourceRemoved: false,
      startedAt: Date.now() - 31 * 60000,
    });
    await expect(
      cancelMachineLaunch(h.deps, "review-removal-window"),
    ).rejects.toThrow("vendor unavailable");
    vi.setSystemTime(160_001);
    await sweepMachineLifecycles(h.deps);
    expect(removes).toBe(2);
    expect(getMachineLaunch(h.db, "review-removal-window")).toMatchObject({
      cancelPending: false,
      resource: null,
      cleanupRetryAt: null,
    });
  }));

it("periodic maintenance does not invalidate an in-flight resume allocation", async () =>
  withTestHarness(async (h) => {
    const { host } = seedHostSession(h.deps, { id: "review-resume-retire" });
    adoptMachine(h, host.id, { snapshot: "image" });
    updateHost(h.db, h.hub, host.id, {
      phase: "suspended",
      suspendedAt: Date.now(),
    });
    const allocated = createDeferredPromise<void>();
    const proceed = createDeferredPromise<void>();
    installMachineProvider(
      machineDeclaration(host.id, {
        suspend: async ({ resource }) => ({ resource }),
        resume: async ({ checkpoint }) => {
          allocated.resolve();
          await proceed.promise;
          await checkpoint({ snapshot: "image", sandbox: "new-sandbox" });
          return { resource: { snapshot: "image", sandbox: "new-sandbox" } };
        },
      }),
    );
    const resuming = resumeMachine(h.deps, host.id).then(
      () => ({ ok: true }),
      (error) => ({ ok: false, error: String(error) }),
    );
    await allocated.promise;
    await sweepProviderMachine(h.deps, host.id);
    proceed.resolve();
    expect(await resuming).toEqual({ ok: true });
    expect(getHost(h.db, host.id)?.resource).toMatchObject({
      sandbox: "new-sandbox",
    });
    await sweepProviderMachine(h.deps, host.id);
    expect(getHost(h.db, host.id)?.phase).toBe("active");
  }));

describe("coordinated machine suspension", () => {
  it("excludes dispatch and durably saves before terminating a machine with no live threads", async () =>
    withTestHarness(async (h) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host } = seedHostSession(h.deps, { id: "host_deadline" });
      adoptMachine(h, host.id);
      const saving = createDeferredPromise<void>();
      const proceed = createDeferredPromise<void>();
      let terminated = false;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ checkpoint }) => {
            saving.resolve();
            await proceed.promise;
            await checkpoint({ snapshot: "durable" });
            expect(getHost(h.db, host.id)?.resource).toEqual({
              snapshot: "durable",
            });
            terminated = true;
            return { resource: { snapshot: "durable" } };
          },
          resume: async ({ resource }) => ({ resource }),
        }),
      );
      const sweep = requestMachineSuspension(h.deps, host.id);
      await saving.promise;
      expect(() => assertMachineLifecycleAdmission(h.deps, host.id)).toThrow(
        "Saving the filesystem",
      );
      expect(terminated).toBe(false);
      proceed.resolve();
      await sweep;
      expect(terminated).toBe(true);
      expect(getHost(h.db, host.id)?.phase).toBe("suspended");
      expect(getHost(h.db, host.id)).toMatchObject({
        phase: "suspended",
        suspendMessage: null,
        suspendRetryAt: null,
      });
    }));

  it("retains compute after failed save and retries after retryAt", async () =>
    withTestHarness(async (h) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host } = seedHostSession(h.deps, { id: "host_failed_save" });
      adoptMachine(h, host.id);
      let fails = true;
      let saves = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ checkpoint }) => {
            saves += 1;
            if (fails) throw new Error("snapshot unavailable");
            await checkpoint({ snapshot: "saved" });
            return { resource: { snapshot: "saved" } };
          },
          resume: async ({ resource }) => ({ resource }),
        }),
      );
      await expect(requestMachineSuspension(h.deps, host.id)).rejects.toThrow(
        "snapshot unavailable",
      );
      expect(getHost(h.db, host.id)).toMatchObject({
        phase: "active",
        suspendMessage: expect.stringContaining("snapshot unavailable"),
        suspendRetryAt: 20_000,
      });
      await expect(requestMachineSuspension(h.deps, host.id)).rejects.toThrow(
        "Machine already has a lifecycle operation",
      );
      expect(saves).toBe(1);
      updateHost(h.db, h.hub, host.id, { suspendRetryAt: 40_000 });
      vi.setSystemTime(30_000);
      await expect(requestMachineSuspension(h.deps, host.id)).rejects.toThrow(
        "Machine already has a lifecycle operation",
      );
      expect(saves).toBe(1);
      fails = false;
      vi.setSystemTime(40_001);
      await sweepProviderMachine(h.deps, host.id);
      await requestMachineSuspension(h.deps, host.id);
      expect(saves).toBe(2);
      expect(getHost(h.db, host.id)).toMatchObject({
        phase: "suspended",
        suspendMessage: null,
        suspendRetryAt: null,
      });
    }));

  it("propagates a provider refusal to restore unsafe state", async () =>
    withTestHarness(async (h) => {
      const { host } = seedHostSession(h.deps, { id: "host_lost_save" });
      adoptMachine(h, host.id, { snapshot: "old" });
      updateHost(h.db, h.hub, host.id, {
        phase: "suspended",
        suspendedAt: Date.now(),
      });
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ resource }) => ({ resource }),
          resume: async () => {
            throw new Error(
              "Provider requires explicit recovery; newer changes may be lost",
            );
          },
        }),
      );
      await expect(
        ensureHostSessionReadyForWork(h.deps, { hostId: host.id }),
      ).rejects.toThrow("Provider requires explicit recovery");
      expect(getHost(h.db, host.id)?.phase).toBe("suspended");
    }));

  it("retains the machine when its provider refuses suspension", async () =>
    withTestHarness(async (h) => {
      const { host } = seedHostSession(h.deps, { id: "host_account_changed" });
      adoptMachine(h, host.id);
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async () => {
            throw new Error("Restore the pinned account");
          },
          resume: async ({ resource }) => ({ resource }),
        }),
      );
      await expect(requestMachineSuspension(h.deps, host.id)).rejects.toThrow(
        "Restore the pinned account",
      );
      expect(getHost(h.db, host.id)).toMatchObject({
        phase: "active",
        suspendMessage: expect.stringContaining("Restore the pinned account"),
        suspendRetryAt: expect.any(Number),
      });
    }));
});

it.each([false, true])(
  "coordinated drain preserves an interrupted active turn and refuses failed stop (%s)",
  async (stopFails) =>
    withTestHarness(async (h) => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(10_000);
      const { host, session } = seedHostSession(h.deps, {
        id: "host_drain_active",
      });
      const { project } = seedProjectWithSource(h.deps, {
        hostId: host.id,
        path: "/tmp/drain-active",
      });
      const environment = createEnvironment(h.db, h.hub, {
        projectId: project.id,
        hostId: host.id,
        path: "/tmp/drain-active",
        providerOwnsPath: false,
        status: "ready",
        environmentProvider: null,
      });
      const thread = seedThread(h.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: "active",
      });
      seedThreadRuntimeState(h.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-drain",
      });
      seedTurnStarted(h.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        turnId: "turn-drain",
      });
      const terminal = createTerminalSession(h.db, {
        threadId: thread.id,
        environmentId: environment.id,
        hostId: host.id,
        daemonSessionId: null,
        title: "open terminal",
        initialCwd: "/tmp/drain-active",
        cols: 80,
        rows: 24,
        status: "disconnected",
      });
      adoptMachine(h, host.id);
      const responder = registerHostRpcResponder(h, {
        hostId: host.id,
        sessionId: session.id,
        restoreCommandCaptureAfterResponse: true,
        handle: (request) => {
          expect(request.command.type).toBe("thread.stop");
          return stopFails
            ? {
                ok: false,
                errorCode: "stop_failed",
                errorMessage: "Provider refused stop",
              }
            : { ok: true, result: { providerCheckpointId: null } };
        },
      });
      let saves = 0;
      installMachineProvider(
        machineDeclaration(host.id, {
          suspend: async ({ resource, checkpoint }) => {
            saves += 1;
            await checkpoint(resource);
            return { resource };
          },
          resume: async ({ resource }) => ({ resource }),
        }),
      );
      if (stopFails) {
        await expect(requestMachineSuspension(h.deps, host.id)).rejects.toThrow(
          "Provider refused stop",
        );
        expect(saves).toBe(0);
        expect(getHost(h.db, host.id)?.phase).toBe("active");
      } else {
        await requestMachineSuspension(h.deps, host.id);
        expect(saves).toBe(1);
        expect(getThread(h.db, thread.id)?.status).not.toBe("active");
        expect(
          h.db
            .select()
            .from(terminalSessions)
            .where(eq(terminalSessions.id, terminal.id))
            .get()?.status,
        ).toBe("exited");
        const recorded = h.db
          .select()
          .from(events)
          .where(eq(events.threadId, thread.id))
          .all();
        expect(
          recorded.some((event) => event.type === "system/thread/interrupted"),
        ).toBe(true);
        expect(
          recorded
            .filter((event) => event.type === "turn/completed")
            .map((event) => event.data),
        ).not.toContainEqual(expect.objectContaining({ status: "completed" }));
      }
      expect(
        responder.requests.some(
          (request) => request.command.type === "thread.stop",
        ),
      ).toBe(true);
    }),
);

it("concurrent dispatch shares one restore and records an expired image failure", async () =>
  withTestHarness(async (h) => {
    const { host } = seedHostSession(h.deps, { id: "host_observed_restore" });
    adoptMachine(h, host.id, { snapshot: "saved-image" });
    updateHost(h.db, h.hub, host.id, {
      phase: "suspended",
      suspendedAt: Date.now(),
    });
    const restoring = createDeferredPromise<void>();
    const proceed = createDeferredPromise<void>();
    let expired = false;
    let resumes = 0;
    installMachineProvider(
      machineDeclaration(host.id, {
        suspend: async ({ resource }) => ({ resource }),
        resume: async ({ resource, checkpoint }) => {
          resumes += 1;
          restoring.resolve();
          await proceed.promise;
          if (expired) throw new Error("Snapshot image no longer exists");
          await checkpoint({
            snapshot: "saved-image",
            sandbox: "restored-once",
          });
          return { resource };
        },
      }),
    );
    const first = ensureHostSessionReadyForWork(h.deps, { hostId: host.id });
    await restoring.promise;
    const second = ensureHostSessionReadyForWork(h.deps, { hostId: host.id });
    proceed.resolve();
    await Promise.all([first, second]);
    expect(resumes).toBe(1);
    expect(getHost(h.db, host.id)).toMatchObject({
      suspendMessage: null,
      suspendRetryAt: null,
    });
    expired = true;
    updateHost(h.db, h.hub, host.id, {
      phase: "suspended",
      suspendedAt: Date.now(),
    });
    await expect(
      ensureHostSessionReadyForWork(h.deps, { hostId: host.id }),
    ).rejects.toThrow("Snapshot image no longer exists");
    expect(getHost(h.db, host.id)).toMatchObject({
      suspendMessage: expect.stringContaining(
        "Snapshot image no longer exists",
      ),
      suspendRetryAt: expect.any(Number),
    });
    expect(getHost(h.db, host.id)?.phase).toBe("suspended");
  }));

it("wakes persisted offline queue intent after a suspended machine is reconciled", async () =>
  withTestHarness(async (h) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(10_000);
    const { host } = seedHostSession(h.deps, { id: "host_queued_wake" });
    adoptMachine(h, host.id, { snapshot: "saved-image" });
    updateHost(h.db, h.hub, host.id, {
      phase: "suspended",
      suspendedAt: Date.now(),
    });
    const { project } = seedProjectWithSource(h.deps, {
      hostId: host.id,
      path: "/tmp/queued-wake",
    });
    const environment = createEnvironment(h.db, h.hub, {
      projectId: project.id,
      hostId: host.id,
      path: "/tmp/queued-wake",
      providerOwnsPath: false,
      status: "ready",
      environmentProvider: null,
    });
    const thread = seedThread(h.deps, {
      projectId: project.id,
      environmentId: environment.id,
      status: "idle",
    });
    let resumes = 0;
    let suspends = 0;
    installMachineProvider(
      machineDeclaration(host.id, {
        suspend: async ({ resource }) => {
          suspends += 1;
          return { resource };
        },
        resume: async ({ resource }) => {
          resumes += 1;
          return { resource };
        },
      }),
    );
    await sweepProviderMachine(h.deps, host.id);
    expect(resumes).toBe(0);
    vi.setSystemTime(20_000);
    createQueuedThreadMessage(h.db, h.hub, {
      threadId: thread.id,
      content: [{ type: "text", text: "continue after restart", mentions: [] }],
      model: "gpt-5",
      reasoningLevel: "medium",
      permissionMode: "auto",
      serviceTier: "default",
      waitingOn: { kind: "host-offline", hostName: "previous host name" },
      sendAt: null,
      payload: { kind: "inline" },
      systemNotice: null,
    });
    await sweepProviderMachine(h.deps, host.id);
    expect(resumes).toBe(1);
    await sweepProviderMachine(h.deps, host.id);
    expect(suspends).toBe(0);
    expect(getHost(h.db, host.id)?.phase).toBe("active");
    expect(getHost(h.db, host.id)?.phase).toBe("active");
  }));

it("recovers a host left suspending after restart", async () =>
  withTestHarness(async (h) => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(100_000);
    const { host } = seedHostSession(h.deps, { id: "abandoned-maintenance" });
    adoptMachine(h, host.id, { snapshot: "durable" });
    updateHost(h.db, h.hub, host.id, {
      phase: "suspending",
      suspendedAt: 40_000,
      machineOperationId: "previous-process",
      suspendMessage: "Saving the filesystem before terminating compute.",
    });
    installMachineProvider(
      machineDeclaration(host.id, {
        suspend: async ({ resource }) => ({ resource }),
        resume: async ({ resource }) => ({ resource }),
      }),
    );
    expect(() => assertMachineLifecycleAdmission(h.deps, host.id)).toThrow(
      "Saving the filesystem",
    );
    await sweepProviderMachine(h.deps, host.id);
    expect(getHost(h.db, host.id)).toMatchObject({
      phase: "active",
      suspendMessage: null,
      suspendRetryAt: null,
    });
    expect(getHost(h.db, host.id)?.resource).toEqual({ snapshot: "durable" });
    expect(() =>
      assertMachineLifecycleAdmission(h.deps, host.id),
    ).not.toThrow();
  }));

it.each([false, true])(
  "accepts a follow-up during pause and continues automatically (saving=%s)",
  async (saving) =>
    withTestHarness(async (h) => {
      const { host, session } = seedHostSession(h.deps, {
        id: "host-followup-pause",
      });
      const { project, environment } = seedMachineWorkspace(
        h,
        host.id,
        "/tmp/pause-followup",
      );
      const thread = seedThread(h.deps, {
        projectId: project.id,
        environmentId: environment.id,
        status: saving ? "idle" : "active",
      });
      seedThreadRuntimeState(h.deps, {
        threadId: thread.id,
        environmentId: environment.id,
        providerThreadId: "provider-pause-followup",
      });
      if (!saving)
        seedTurnStarted(h.deps, {
          threadId: thread.id,
          environmentId: environment.id,
          turnId: "turn-pause-followup",
        });
      const entered = createDeferredPromise<void>();
      const release = createDeferredPromise<void>();
      const socket = registerTestHostRpcCapture(h.deps, {
        hostId: host.id,
        sessionId: session.id,
      });
      if (!saving)
        registerHostRpcResponder(h, {
          hostId: host.id,
          sessionId: session.id,
          handle: async (request) => {
            if (request.command.type !== "thread.stop")
              throw new Error(`Unexpected ${request.command.type}`);
            entered.resolve();
            await release.promise;
            return { ok: true, result: { providerCheckpointId: null } };
          },
        });
      const suspend = vi.fn(async ({ resource }: { resource: JsonValue }) => {
        entered.resolve();
        await release.promise;
        return { resource };
      });
      const resume = vi.fn(async ({ resource }: { resource: JsonValue }) => {
        h.hub.registerDaemon(session.id, host.id, socket);
        return { resource };
      });
      installMachineProvider(machineDeclaration(host.id, { suspend, resume }));
      adoptMachine(h, host.id);
      const pause = requestMachineSuspension(h.deps, host.id).then(
        () => "paused",
        (error: Error) => error.message,
      );
      await entered.promise;
      const current = getThread(h.db, thread.id);
      if (!current) throw new Error("missing thread");
      const outcome = await attemptDispatch(h.deps, {
        thread: current,
        payload: { input: textInput("continue after pause"), mode: "auto" },
        source: { kind: "inline" },
        queuePayload: { kind: "inline" },
        origin: null,
        originPluginId: null,
        startedOnBehalfOf: null,
        trigger: "user",
      });
      expect(outcome.kind).toBe("queued");
      expect(listQueuedThreadMessages(h.db, thread.id)).toHaveLength(1);
      expect(resume).not.toHaveBeenCalled();
      release.resolve();
      expect(await pause).toBe(
        saving ? "paused" : "Pause cancelled because a follow-up was sent.",
      );
      await vi.waitFor(() =>
        expect(getHost(h.db, host.id)?.phase).toBe("active"),
      );
      expect(suspend).toHaveBeenCalledTimes(saving ? 1 : 0);
      expect(resume).toHaveBeenCalledTimes(saving ? 1 : 0);
      await vi.waitFor(() =>
        expect(
          listQueuedThreadMessages(h.db, thread.id)[0]?.waitingOn,
        ).not.toMatchObject({ kind: "host-offline" }),
      );
    }),
);
