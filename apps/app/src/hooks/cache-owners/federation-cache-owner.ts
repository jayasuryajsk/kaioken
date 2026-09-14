import type { QueryClient } from "@tanstack/react-query";
import { remoteServerSnapshotQueryKey } from "../queries/federation-queries";
import {
  remotePendingInteractionsQueryKey,
  remoteThreadQueryKey,
  remoteTimelineQueryKey,
} from "../queries/remote-thread-queries";

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

export function invalidateRemoteServerSnapshot(args: {
  queryClient: QueryClient;
  handle: string;
}): void {
  void args.queryClient.invalidateQueries({
    queryKey: remoteServerSnapshotQueryKey(args.handle),
  });
}
