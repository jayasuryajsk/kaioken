import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@kaioken/shared-ui/tooltip";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  REMOTE_THREAD_READ_ONLY_HINT,
  formatOfflineMeta,
  useNow,
} from "@/components/sidebar/TimelineThreadList";
import { ThreadTimelineSurface } from "@/components/thread/timeline/ThreadTimelineSurface";
import { PageShell } from "@/components/ui/page-shell.js";
import {
  REMOTE_SNAPSHOT_REFETCH_MS,
  useAccountServers,
} from "@/hooks/queries/federation-queries";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import { getThreadDisplayTitle } from "@/lib/thread-title";

export function remoteThreadBanner(serverName: string): string {
  return `This thread lives on ${serverName}. ${REMOTE_THREAD_READ_ONLY_HINT}`;
}

export function remoteWriteDisabledReason(serverName: string): string {
  return `Read-only: this thread lives on ${serverName}.`;
}

function remoteThreadQueryKey(handle: string, threadId: string) {
  return ["federation", "thread", handle, threadId] as const;
}

function remoteTimelineQueryKey(handle: string, threadId: string) {
  return ["federation", "timeline", handle, threadId] as const;
}

function useRemoteThread(
  server: FederatedServer | undefined,
  threadId: string,
) {
  const enabled = server !== undefined && server.live && threadId.length > 0;
  const url = server?.url ?? "";
  const handle = server?.handle ?? "";
  const thread = useQuery({
    queryKey: remoteThreadQueryKey(handle, threadId),
    queryFn: () => getRemoteSdk(url).threads.get({ threadId }),
    enabled,
    refetchInterval: REMOTE_SNAPSHOT_REFETCH_MS,
    retry: false,
  });
  const timeline = useQuery({
    queryKey: remoteTimelineQueryKey(handle, threadId),
    queryFn: () => getRemoteSdk(url).threads.timeline({ threadId }),
    enabled,
    refetchInterval: REMOTE_SNAPSHOT_REFETCH_MS,
    retry: false,
  });
  return { thread, timeline };
}

function ReadOnlyComposer({ serverName }: { serverName: string }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <div
            data-testid="remote-thread-composer"
            className="mx-auto flex w-full max-w-[760px] items-center gap-2 rounded-lg border border-border bg-surface-recessed px-3 py-2 text-sm text-muted-foreground"
          >
            <Icon name="Lock" className="size-4 shrink-0" />
            <span className="min-w-0 flex-1 truncate">
              Reply on {serverName} to continue this thread.
            </span>
            <button
              type="button"
              disabled
              aria-disabled="true"
              data-testid="remote-thread-send"
              className="rounded-md border border-border px-2 py-1 text-xs opacity-60"
            >
              Send
            </button>
          </div>
        </TooltipTrigger>
        <TooltipContent>{remoteWriteDisabledReason(serverName)}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RemoteThreadBanner({
  server,
  now,
}: {
  server: FederatedServer;
  now: number;
}) {
  return (
    <div
      data-testid="remote-thread-banner"
      className={cn(
        "mb-3 flex items-center gap-2 rounded-lg border border-border bg-surface-recessed px-3 py-2 text-xs text-muted-foreground",
      )}
    >
      <MachineStatusDot connected={server.live} />
      <span className="min-w-0 flex-1">
        {remoteThreadBanner(server.name)}
        {server.live ? null : (
          <span className="text-subtle-foreground">
            {" "}
            · {formatOfflineMeta(server.lastSeenAt, now)}
          </span>
        )}
      </span>
    </div>
  );
}

export function RemoteThreadView() {
  const params = useParams<{ handle: string; threadId: string }>();
  const handle = params.handle ?? "";
  const threadId = params.threadId ?? "";
  const now = useNow();
  const serversQuery = useAccountServers();
  const server = useMemo(
    () => serversQuery.data?.find((candidate) => candidate.handle === handle),
    [handle, serversQuery.data],
  );
  const { thread, timeline } = useRemoteThread(server, threadId);
  const title =
    thread.data === undefined ? threadId : getThreadDisplayTitle(thread.data);

  if (server === undefined) {
    return (
      <PageShell>
        <p
          data-testid="remote-thread-unknown-server"
          className="px-2 py-4 text-sm text-muted-foreground"
        >
          {serversQuery.isPending
            ? "Looking up this Kaioken…"
            : `No Kaioken with the handle "${handle}" is on this account.`}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell footer={<ReadOnlyComposer serverName={server.name} />}>
      <RemoteThreadBanner server={server} now={now} />
      <h1
        data-testid="remote-thread-title"
        className="mb-3 truncate px-2 text-base font-semibold text-foreground"
      >
        {title}
      </h1>
      {server.live ? (
        <ThreadTimelineSurface
          activeThinking={null}
          isThreadTimelinePending={timeline.isPending}
          timelineError={timeline.isError}
          showOngoingIndicator={false}
          timelineRows={timeline.data?.rows ?? []}
          threadId={threadId}
          threadRuntimeDisplayStatus={
            thread.data?.runtime.displayStatus ?? "idle"
          }
          workspaceRootPath={undefined}
        />
      ) : (
        <p className="px-2 py-4 text-sm text-muted-foreground">
          {server.name} is offline. This thread will load when it comes back.
        </p>
      )}
    </PageShell>
  );
}
