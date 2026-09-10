import { validatePluginMachineProviderDeclaration } from "@get-bb/plugin-sdk/internal/host-policy";
import type { MachineEnrollments } from "@get-bb/plugin-sdk";
import type { MachineEnrollmentService } from "./machine-services.js";
import { manualEnrollmentCommand } from "./manual-enrollment-command.js";
import type {
  PluginMachineProviderBridge,
  PluginMachineProviderRecord,
} from "../plugins/plugin-machine-provider-registry.js";

const MANUAL_PROVIDER_OWNER = "core";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createManualMachineProviderRecord(
  enrollments: MachineEnrollments,
): PluginMachineProviderRecord {
  return {
    pluginId: MANUAL_PROVIDER_OWNER,
    provider: validatePluginMachineProviderDeclaration({
      id: "manual",
      displayName: "Manual machine setup",
      description:
        "Run one command on a machine you already have to connect it to this server.",
      icon: "Terminal",
      async create(context) {
        context.signal.throwIfAborted();
        const enrollment = await enrollments.prepare({ key: context.key });
        const resource = { hostId: enrollment.hostId };
        await context.checkpoint(resource);
        context.signal.throwIfAborted();
        context.report.step("Run the enrollment command shown below");
        await enrollments.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: 15 * 60_000,
          signal: context.signal,
        });
        context.report.step("Machine connected");
        return { status: "created", resource };
      },
      async reconcileCleanup() {
        return { status: "removed" };
      },
      async remove(context) {
        context.report.step(
          `Uninstall the machine service with its original installer: install-machine.sh --uninstall --host-id ${context.hostId}`,
        );
        return { status: "removed" };
      },
    }),
  };
}

export function withManualMachineProvider(
  bridge: PluginMachineProviderBridge,
  enrollments: MachineEnrollmentService,
): PluginMachineProviderBridge {
  const manual = createManualMachineProviderRecord(
    enrollments.forOwner(MANUAL_PROVIDER_OWNER),
  );
  return {
    decisionTimeoutMs: bridge.decisionTimeoutMs,
    listMachineProviders: () => [
      manual,
      ...bridge
        .listMachineProviders()
        .filter((record) => record.provider.id !== manual.provider.id),
    ],
    getMachineProvider: (id) =>
      id === manual.provider.id ? manual : bridge.getMachineProvider(id),
    async invokeProvider(pluginId, label, run) {
      if (pluginId !== MANUAL_PROVIDER_OWNER)
        return bridge.invokeProvider(pluginId, label, run);
      try {
        return { ok: true, value: await run() };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
}

export async function manualLaunchCommand(
  enrollments: MachineEnrollmentService,
  launchId: string,
): Promise<string | null> {
  const bootstrap = await enrollments.pendingBootstrapForLaunch({
    launchId,
    owner: MANUAL_PROVIDER_OWNER,
  });
  return bootstrap === null ? null : manualEnrollmentCommand(bootstrap);
}
