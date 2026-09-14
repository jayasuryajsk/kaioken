import { useEffect, useState } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
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

export function invalidateRemoteThreadQueries(args: {
  queryClient: QueryClient;
  handle: string;
  threadId: string;
}): void {
  for (const queryKey of [
    remoteThreadQueryKey(args.handle, args.threadId),
    remoteTimelineQueryKey(args.handle, args.threadId),
    remotePendingInteractionsQueryKey(args.handle, args.threadId),
  ]) {
    void args.queryClient.invalidateQueries({ queryKey });
  }
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
    const unsubscribeChanges = remote.subscribe({
      event: "thread:changed",
      threadId,
      callback: () => {
        invalidateRemoteThreadQueries({ queryClient, handle, threadId });
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
  const timeline = useQuery({
    queryKey: remoteTimelineQueryKey(handle, threadId),
    queryFn: () => getRemoteSdk(url).threads.timeline({ threadId }),
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
