import type { MachineLifecycle } from "@bb/domain";
import { cn } from "@bb/shared-ui/lib/utils";

interface MachinePhaseBadgeProps {
  lifecycle: MachineLifecycle;
}

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

export function MachinePhaseBadge({ lifecycle }: MachinePhaseBadgeProps) {
  const label = machinePhaseLabel(lifecycle);
  if (label === null) return null;
  return (
    <span
      className={cn(
        "shrink-0 rounded-sm border px-1.5 py-0.5 text-2xs leading-none",
        (label === "Paused" || label === "Pausing") &&
          "border-border bg-muted/40 text-subtle-foreground",
        label === "Retiring" &&
          "border-attention/50 bg-surface-attention text-warning-text",
        label === "Cleanup failed" &&
          "border-destructive/40 bg-destructive/10 text-destructive",
      )}
    >
      {label}
    </span>
  );
}
