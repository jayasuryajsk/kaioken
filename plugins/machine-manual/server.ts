import { manualRpcContract } from "./rpc.js";
import type { EnrollmentBootstrap, BbPluginApi } from "@get-bb/plugin-sdk";

export default function manualMachinePlugin(bb: BbPluginApi): void {
  const pending = new Map<string, EnrollmentBootstrap>();
  bb.onDispose(() => pending.clear());
  bb.rpc.register(manualRpcContract, {
    command: ({ launchId }) => {
      const enrollment = pending.get(launchId);
      if (!enrollment) return { command: null, expiresAt: null };
      if (enrollment.expiresAt <= Date.now()) {
        pending.delete(launchId);
        return { command: null, expiresAt: enrollment.expiresAt };
      }
      const quote = (value: string) =>
        "'" + value.replaceAll("'", "'\"'\"'") + "'";
      return {
        command: `curl -fsSL -H ${quote(`X-BB-Enrollment: ${enrollment.credential}`)} ${quote(new URL("/install.sh", enrollment.serverUrl).href)} | sh`,
        expiresAt: enrollment.expiresAt,
      };
    },
  });
  bb.experimental_machines.register({
    id: "manual",
    displayName: "Manual machine setup",
    description:
      "Run one command on a machine you already have to connect it to this server.",
    icon: "Terminal",

    async create(context) {
      context.signal.throwIfAborted();
      const enrollment = await bb.experimental_machines.enrollments.prepare({
        key: context.key,
      });
      if (enrollment.state === "pending")
        pending.set(context.key, enrollment.bootstrap);
      try {
        const resource = { version: 1, hostId: enrollment.hostId };
        await context.checkpoint(resource);
        context.signal.throwIfAborted();
        context.report.step("Run the enrollment command shown in the picker");
        await bb.experimental_machines.enrollments.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: 15 * 60_000,
          signal: context.signal,
        });
        context.report.step("Machine connected");
        return { status: "created", resource };
      } finally {
        pending.delete(context.key);
      }
    },
    async reconcileCleanup() {
      return { status: "removed" };
    },
    async remove(context) {
      context.report.step(
        `Uninstall manually on the machine: bb machine uninstall --host-id ${context.hostId}`,
      );
      return { status: "removed" };
    },
  });
}
