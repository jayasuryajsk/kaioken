import type { QueryClient } from "@tanstack/react-query";
import type { HandoffStatus } from "@kaioken/server-contract";
import {
  connectionHandoffQueryKey,
  federationQueryKeyPrefix,
  sshConnectionsQueryKey,
} from "../queries/query-keys";

export function setConnectionHandoffStatus(
  queryClient: QueryClient,
  status: HandoffStatus,
): void {
  queryClient.setQueryData(connectionHandoffQueryKey(status.id), status);
}

export function invalidateSshConnections(
  queryClient: QueryClient,
): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: sshConnectionsQueryKey() });
}

export function invalidateFederationQueries(
  queryClient: QueryClient,
): Promise<void> {
  return queryClient.invalidateQueries({
    queryKey: federationQueryKeyPrefix(),
  });
}
