import type { Host, MachineLifecycle } from "@bb/domain";
import { formatRelativeTime } from "@/lib/relative-time";

export type MachineStatusTone =
  | "online"
  | "attention"
  | "failed"
  | "offline";

export function machinePhaseLabel(
  lifecycle: MachineLifecycle,
): "Paused" | "Pausing" | "Retiring" | "Cleanup failed" | null {
  if (
    lifecycle.phase === "retiring" &&
    lifecycle.teardown?.status === "failed"
  ) {
    return "Cleanup failed";
  }
  if (lifecycle.phase === "suspending") return "Pausing";
  if (lifecycle.phase === "suspended") return "Paused";
  if (lifecycle.phase === "retiring") return "Retiring";
  return null;
}

export function machineStatusTone(host: Host): MachineStatusTone {
  if (machinePhaseLabel(host.lifecycle) === "Cleanup failed") return "failed";
  if (
    host.lifecycle.phase === "retiring" ||
    host.lifecycle.phase === "suspending"
  )
    return "attention";
  return host.status === "connected" ? "online" : "offline";
}

export function machineStatusLabel({
  host,
  now,
}: {
  host: Host;
  now: number;
}): string {
  const parts: string[] = [];
  const phase = machinePhaseLabel(host.lifecycle);
  parts.push(phase ?? (host.status === "connected" ? "Online" : "Offline"));
  if (host.lifecycle.progress !== null) parts.push(host.lifecycle.progress);
  else if (host.status !== "connected" && host.lastSeenAt !== null) {
    parts.push(
      `last seen ${formatRelativeTime({ timestamp: host.lastSeenAt, now })}`,
    );
  }
  return parts.join(" · ");
}
