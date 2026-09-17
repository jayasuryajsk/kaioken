import type { QueryClient } from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import {
  accountServersQueryKey,
  remoteServerSnapshotQueryKey,
} from "../queries/federation-queries";
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
  cancelRefetch?: boolean;
}): void {
  void args.queryClient.invalidateQueries(
    { queryKey: remoteServerSnapshotQueryKey(args.handle) },
    args.cancelRefetch === undefined
      ? undefined
      : { cancelRefetch: args.cancelRefetch },
  );
}

export function setAccountServers(
  queryClient: QueryClient,
  servers: FederatedServer[],
): void {
  queryClient.setQueryData(accountServersQueryKey(), servers);
}

export function invalidateAccountServers(queryClient: QueryClient): void {
  void queryClient.invalidateQueries({ queryKey: accountServersQueryKey() });
}
