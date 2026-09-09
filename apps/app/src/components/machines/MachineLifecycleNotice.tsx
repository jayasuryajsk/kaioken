import { useQuery } from "@tanstack/react-query";
import type { experimental_HostLifecycleResponse } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import { sdk } from "@/lib/sdk";

type MachineLifecycleNoticeState = Pick<
  experimental_HostLifecycleResponse,
  "message" | "recoveryState"
> | null;

export function useMachineLifecycleNotice({
  hostId,
  enabled = true,
}: {
  hostId: string;
  enabled?: boolean;
}): MachineLifecycleNoticeState {
  const query = useQuery({
    queryKey: ["machine-lifecycle", hostId],
    queryFn: () => sdk.hosts.experimental_lifecycle({ hostId }),
    refetchInterval: 10_000,
    enabled,
  });
  return query.data ?? null;
}

export function MachineLifecycleNotice({
  hostId,
  onRemove,
}: {
  hostId: string;
  onRemove: () => void;
}) {
  const notice = useMachineLifecycleNotice({ hostId });
  return <MachineLifecycleNoticeContent notice={notice} onRemove={onRemove} />;
}

export function MachineLifecycleNoticeContent({
  notice,
  onRemove,
}: {
  notice: MachineLifecycleNoticeState;
  onRemove: () => void;
}) {
  if (notice === null || notice.message === null) return null;
  return (
    <div
      className="flex min-w-0 flex-col gap-2 text-xs"
      aria-label="Machine maintenance"
    >
      <p role="status">{notice.message}</p>
      {notice.recoveryState === "recoverable" ? (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={onRemove}>
            Remove machine
          </Button>
        </div>
      ) : null}
    </div>
  );
}
