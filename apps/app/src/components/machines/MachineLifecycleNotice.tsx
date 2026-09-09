import { useQuery } from "@tanstack/react-query";
import type { experimental_HostLifecycleResponse } from "@bb/server-contract";
import { cn } from "@bb/shared-ui/lib/utils";
import { sdk } from "@/lib/sdk";

type MachineLifecycleNoticeState = Pick<
  experimental_HostLifecycleResponse,
  "message" | "recoveryState"
> | null;

export function MachineLifecycleNotice({ hostId }: { hostId: string }) {
  const query = useQuery({
    queryKey: ["machine-lifecycle", hostId],
    queryFn: () => sdk.hosts.experimental_lifecycle({ hostId }),
    refetchInterval: 10_000,
  });
  return <MachineLifecycleNoticeContent notice={query.data ?? null} />;
}

export function MachineLifecycleNoticeContent({
  notice,
}: {
  notice: MachineLifecycleNoticeState;
}) {
  if (notice === null || notice.message === null) return null;
  return (
    <p
      role="status"
      aria-label="Machine maintenance"
      className={cn(
        "min-w-0 text-xs",
        notice.recoveryState === "recoverable"
          ? "text-destructive-text"
          : "text-subtle-foreground",
      )}
    >
      {notice.message}
    </p>
  );
}
