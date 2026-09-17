import type { TimelinePaginationCursor } from "@kaioken/server-contract";
import { useEffect, useState } from "react";
import {
  useInfiniteQuery,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import { invalidateRemoteThreadQueries } from "../cache-owners/federation-cache-owner";
import { REMOTE_SNAPSHOT_REFETCH_MS } from "./federation-queries";

export function remoteThreadQueryKey(handle: string, threadId: string) {
  return ["federation", "thread", handle, threadId] as const;
}

export function remoteTimelineQueryKey(handle: string, threadId: string) {
  return ["federation", "timeline", handle, threadId] as const;
}

export function remotePendingInteractionsQueryKey(
  handle: string,
  threadId: string,
) {
  return ["federation", "pending-interactions", handle, threadId] as const;
}

export function remoteExecutionOptionsQueryKey(
  handle: string,
  threadId: string,
) {
  return ["federation", "execution-options", handle, threadId] as const;
}

export type RemoteRealtimeState = "connected" | "disconnected";

export function useRemoteThreadRealtime(
  server: FederatedServer | undefined,
  threadId: string,
): RemoteRealtimeState {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(false);
  const enabled = server !== undefined && server.live && threadId.length > 0;
  const url = server?.url ?? "";
  const handle = server?.handle ?? "";

  useEffect(() => {
    if (!enabled) return;
    const remote = getRemoteSdk(url);
    let refreshTimer: ReturnType<typeof setTimeout> | undefined;
    const unsubscribeChanges = remote.subscribe({
      event: "thread:changed",
      threadId,
      callback: () => {
        if (refreshTimer !== undefined) return;
        refreshTimer = setTimeout(() => {
          refreshTimer = undefined;
          invalidateRemoteThreadQueries({ queryClient, handle, threadId });
        }, 300);
      },
    });
    const unsubscribeConnection = remote.subscribe({
      event: "realtime:connection",
      callback: (event) => {
        setConnected(event.state === "connected");
        if (event.state === "connected" && event.reconnected) {
          invalidateRemoteThreadQueries({ queryClient, handle, threadId });
        }
      },
    });
    return () => {
      clearTimeout(refreshTimer);
      unsubscribeChanges();
      unsubscribeConnection();
      setConnected(false);
    };
  }, [enabled, handle, queryClient, threadId, url]);

  return enabled && connected ? "connected" : "disconnected";
}

export function useRemoteThread(
  server: FederatedServer | undefined,
  threadId: string,
) {
  const enabled = server !== undefined && server.live && threadId.length > 0;
  const url = server?.url ?? "";
  const handle = server?.handle ?? "";
  const realtime = useRemoteThreadRealtime(server, threadId);
  const refetchInterval =
    realtime === "connected" ? false : REMOTE_SNAPSHOT_REFETCH_MS;
  const thread = useQuery({
    queryKey: remoteThreadQueryKey(handle, threadId),
    queryFn: () => getRemoteSdk(url).threads.get({ threadId }),
    enabled,
    refetchInterval,
    retry: false,
  });
  const pages = useInfiniteQuery({
    queryKey: [...remoteTimelineQueryKey(handle, threadId), "pages"],
    initialPageParam: null as TimelinePaginationCursor | null,
    queryFn: ({ pageParam, signal }) =>
      getRemoteSdk(url).threads.timeline({
        threadId,
        signal,
        ...(pageParam === null
          ? {}
          : {
              beforeAnchorSeq: String(pageParam.anchorSeq),
              beforeAnchorId: pageParam.anchorId,
            }),
      }),
    getNextPageParam: (last) =>
      last.timelinePage.hasOlderRows ? last.timelinePage.olderCursor : null,
    enabled,
    refetchInterval,
    retry: false,
  });
  const pendingInteractions = useQuery({
    queryKey: remotePendingInteractionsQueryKey(handle, threadId),
    queryFn: () => getRemoteSdk(url).threads.interactions.list({ threadId }),
    enabled,
    refetchInterval,
    retry: false,
  });
  const timeline = {
    ...pages,
    data: pages.data
      ? {
          ...pages.data.pages[0]!,
          rows: [
            ...new Map(
              [...pages.data.pages]
                .reverse()
                .flatMap((page) => page.rows)
                .map((row) => [row.id, row]),
            ).values(),
          ],
        }
      : undefined,
  };
  const executionOptions = useQuery({
    queryKey: remoteExecutionOptionsQueryKey(handle, threadId),
    queryFn: () =>
      getRemoteSdk(url).threads.defaultExecutionOptions({ threadId }),
    enabled,
    staleTime: 5 * 60_000,
    retry: false,
  });
  return { thread, timeline, pendingInteractions, executionOptions, realtime };
}
