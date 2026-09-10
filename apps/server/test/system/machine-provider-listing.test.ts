import { ensurePersonalProject, setProjectGitRemoteUrlIfMissing } from "@bb/db";
import { PERSONAL_PROJECT_ID } from "@bb/domain";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import {
  validatePluginEnvironmentProviderDeclaration,
  validatePluginMachineProviderDeclaration,
} from "@get-bb/plugin-sdk/internal/host-policy";
import { systemMachineProvidersResponseSchema } from "@bb/server-contract";
import { setPluginEnvironmentProviderBridge } from "../../src/services/plugins/plugin-environment-provider-registry.js";
import { setPluginMachineProviderBridge } from "../../src/services/plugins/plugin-machine-provider-registry.js";
import { completeProviderSelection } from "../../src/services/threads/thread-environment-placement.js";
import { resolveMachineProviderAvailability } from "../../src/services/machines/provider-availability.js";
import { createMachine } from "../../src/services/machines/provider-orchestration.js";
import { seedHostSession, seedProjectWithSource } from "../helpers/seed.js";
import { withTestHarness } from "../helpers/test-app.js";

afterEach(() => {
  setPluginMachineProviderBridge(undefined);
  setPluginEnvironmentProviderBridge(undefined);
});

describe("machine provider listing", () => {
  it.each(["git-project", "no-remote", "personal", "unscoped"] as const)(
    "keeps machine providers independent of project scope for %s",
    async (scope) => {
      await withTestHarness(async (harness) => {
        const { host } = seedHostSession(harness.deps, { id: "row-host" });
        const { project } = seedProjectWithSource(harness.deps, {
          hostId: host.id,
        });
        ensurePersonalProject(harness.db);
        if (scope === "git-project")
          setProjectGitRemoteUrlIfMissing(
            harness.db,
            harness.hub,
            project.id,
            "https://example.test/repo.git",
          );
        const environmentRecords = [
          { id: "project-checkout", requires: { projectCheckout: true } },
          { id: "personal-workspace", requires: { projectless: true } },
        ].map(({ id, requires }) => ({
          pluginId: "test-environment",
          provider: validatePluginEnvironmentProviderDeclaration({
            id,
            displayName: id,
            requires,
            create: async () => ({
              status: "created",
              path: "/workspace",
              ownsPath: false,
            }),
            remove: async () => ({ status: "removed" }),
          }),
        }));
        setPluginEnvironmentProviderBridge({
          listEnvironmentProviders: () => environmentRecords,
          getEnvironmentProvider: (id) =>
            environmentRecords.find((record) => record.provider.id === id),
          invokeProvider: async (_pluginId, _label, run) => ({
            ok: true,
            value: await run(),
          }),
          decisionTimeoutMs: 10_000,
        });
        const machineRecord = {
          pluginId: "test-machine",
          provider: validatePluginMachineProviderDeclaration({
            description: "Provision a test machine.",
            icon: "Terminal",
            reconcileCleanup: async () => ({ status: "removed" }),
            id: "test-machine",
            displayName: "Test machine",
            inputs: z.object({ size: z.string() }),
            create: async () => ({
              status: "created",
              hostId: host.id,
              resource: {},
            }),
            remove: async () => ({ status: "removed" }),
          }),
        };
        const machineRecords = [machineRecord];
        setPluginMachineProviderBridge({
          listMachineProviders: () => machineRecords,
          getMachineProvider: (id) =>
            machineRecords.find((record) => record.provider.id === id),
          invokeProvider: async (_pluginId, _label, run) => ({
            ok: true,
            value: await run(),
          }),
          decisionTimeoutMs: 10_000,
        });
        const projectId =
          scope === "unscoped"
            ? undefined
            : scope === "personal"
              ? PERSONAL_PROJECT_ID
              : project.id;
        const response = await harness.app.request(
          `/api/v1/system/machine-providers${projectId === undefined ? "" : `?projectId=${projectId}`}`,
        );
        expect(response.status).toBe(200);
        const { providers } = systemMachineProvidersResponseSchema.parse(
          await response.json(),
        );
        expect(providers).toHaveLength(1);
        expect(providers[0]).not.toHaveProperty("requires");
        expect(providers[0]).not.toHaveProperty("environmentRow");
        expect(providers[0]).toMatchObject({
          availability: { status: "available" },
          acceptsEmptyInputs: false,
          inputs: { type: "object", properties: { size: { type: "string" } } },
        });
        if (scope === "personal") {
          const personal = environmentRecords.find(
            (record) => record.provider.id === "personal-workspace",
          );
          if (personal === undefined)
            throw new Error("Missing personal provider");
          const selection = await completeProviderSelection(
            harness.deps,
            personal,
            PERSONAL_PROJECT_ID,
            {
              machine: {
                type: "new",
                machineProviderId: "test-machine",
                inputs: { size: "small" },
              },
              inputs: null,
            },
          );
          expect(selection.machine).toEqual({
            type: "new",
            machineProviderId: "test-machine",
            inputs: { size: "small" },
          });
          expect(
            await createMachine(harness.deps, {
              machineProviderId: "test-machine",
              inputs: { size: "small" },
            }),
          ).toMatchObject({ id: host.id });
        }
        if (scope === "unscoped") {
          expect(
            await createMachine(harness.deps, {
              machineProviderId: "test-machine",
              inputs: { size: "small" },
            }),
          ).toMatchObject({ id: host.id });
        }
      });
    },
  );
});

it("rechecks availability after provider setup changes without restarting the plugin", async () => {
  await withTestHarness(async (harness) => {
    let configured = false;
    const record = {
      pluginId: "test-machine",
      provider: validatePluginMachineProviderDeclaration({
        description: "Provision a test machine.",
        icon: "Terminal",
        id: "test-machine",
        displayName: "Test machine",
        availability: () =>
          configured
            ? { status: "available" }
            : { status: "setup-required", message: "Connect your account" },
        create: async () => ({
          status: "created",
          hostId: "test-host",
          resource: {},
        }),
        reconcileCleanup: async () => ({ status: "removed" }),
        remove: async () => ({ status: "removed" }),
      }),
    };
    setPluginMachineProviderBridge({
      listMachineProviders: () => [record],
      getMachineProvider: () => record,
      invokeProvider: async (_pluginId, _label, run) => ({
        ok: true,
        value: await run(),
      }),
      decisionTimeoutMs: 10_000,
    });
    expect(await resolveMachineProviderAvailability(record)).toEqual({
      status: "setup-required",
      message: "Connect your account",
    });
    configured = true;
    expect(await resolveMachineProviderAvailability(record)).toEqual({
      status: "available",
    });
  });
});

it("lists compositions once outside host groups and preserves machine setup availability", async () => {
  await withTestHarness(async (h) => {
    const { host } = seedHostSession(h.deps, { id: "composition-host" });
    const { project } = seedProjectWithSource(h.deps, { hostId: host.id });
    const environment = {
      pluginId: "checkout",
      provider: validatePluginEnvironmentProviderDeclaration({
        id: "project-checkout",
        displayName: "Project checkout",
        requires: { projectCheckout: true },
        create: async () => ({
          status: "created",
          path: "/checkout",
          ownsPath: false,
        }),
        remove: async () => ({ status: "removed" }),
      }),
    };
    const machine = {
      pluginId: "cloud",
      provider: validatePluginMachineProviderDeclaration({
        description: "Provision a test machine.",
        icon: "Terminal",
        id: "cloud-machine",
        displayName: "Cloud machine",
        availability: () => ({
          status: "setup-required",
          message: "Connect account",
        }),
        create: async () => {
          throw new Error("Listing must not provision");
        },
        reconcileCleanup: async () => ({ status: "removed" }),
        remove: async () => ({ status: "removed" }),
      }),
    };
    setPluginEnvironmentProviderBridge({
      listEnvironmentProviders: () => [environment],
      getEnvironmentProvider: (id) =>
        id === environment.provider.id ? environment : undefined,
      listEnvironmentCompositions: () => [
        {
          pluginId: "cloud",
          composition: {
            id: "cloud-sandbox",
            displayName: "Cloud sandbox",
            machineProviderId: "cloud-machine",
            environmentProviderId: "project-checkout",
          },
        },
      ],
      invokeProvider: async (_pluginId, _label, run) => ({
        ok: true,
        value: await run(),
      }),
      decisionTimeoutMs: 10000,
    });
    setPluginMachineProviderBridge({
      listMachineProviders: () => [machine],
      getMachineProvider: (id) =>
        id === machine.provider.id ? machine : undefined,
      invokeProvider: async (_pluginId, _label, run) => ({
        ok: true,
        value: await run(),
      }),
      decisionTimeoutMs: 10000,
    });
    const list = async (hostId?: string) => {
      const response = await h.app.request(
        `/api/v1/system/environment-providers?projectId=${project.id}${hostId ? "&hostId=" + hostId : ""}`,
      );
      return (await response.json()).providers;
    };
    expect(await list()).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cloud-sandbox" }),
      ]),
    );
    setProjectGitRemoteUrlIfMissing(
      h.db,
      h.hub,
      project.id,
      "https://example.test/project.git",
    );
    expect(await list()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: "cloud-sandbox",
          environmentProviderId: "project-checkout",
          machineProviderId: "cloud-machine",
          availability: {
            status: "setup-required",
            message: "Connect account",
          },
        }),
      ]),
    );
    expect(await list(host.id)).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "cloud-sandbox" }),
      ]),
    );
  });
});
