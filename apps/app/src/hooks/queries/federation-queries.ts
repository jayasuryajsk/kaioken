import { subscribeRemoteSnapshot } from "@/lib/federation/snapshot-subscription";
import { workspaceEmbedding } from "@/lib/federation/workspace-protocol";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { wsManager } from "@/lib/ws";
import {
  selectRemoteServers,
  type FederatedServer,
  type RemoteServerSnapshot,
} from "@kaioken/client-core";
import type { SidebarBootstrapResponse } from "@kaioken/server-contract";
import {
  listAccountServersResultSchema,
  readMockAccountServers,
  readStoredServers,
  toFederatedServers,
  writeStoredServers,
} from "@/lib/federation/account-servers";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import { bindConnectionIdentity } from "@/lib/federation/connection-identities";
import {
  readStoredSnapshot,
  writeStoredSnapshot,
} from "@/lib/federation/remote-snapshots";
import { sdk } from "@/lib/sdk";
import { useSshConnections, sshConnectionHandle } from "./connection-queries";

export const ACCOUNT_SERVERS_REFETCH_MS = 5 * 60_000;
export const REMOTE_SNAPSHOT_REFETCH_MS = 60_000;
const CONNECT_PLUGIN_ID = "connect";
const LIST_ACCOUNT_SERVERS_RPC = "listAccountServers";

export interface RemoteSnapshotFetchResult {
  bootstrap: SidebarBootstrapResponse | null;
  fetchedAt: number | null;
  reachable: boolean;
}

export function accountServersQueryKey() {
  return ["federation", "servers"] as const;
}

export function remoteServerSnapshotQueryKey(handle: string) {
  return ["federation", "snapshot", handle] as const;
}

function markRemotesOffline(
  servers: readonly FederatedServer[],
): FederatedServer[] {
  return servers.map((server) =>
    server.home ? server : { ...server, live: false },
  );
}

export async function fetchAccountServers(
  previous: readonly FederatedServer[],
): Promise<FederatedServer[]> {
  try {
    const result =
      readMockAccountServers() ??
      (await sdk.plugins.callRpc({
        pluginId: CONNECT_PLUGIN_ID,
        method: LIST_ACCOUNT_SERVERS_RPC,
        outputSchema: listAccountServersResultSchema,
      }));
    const servers = toFederatedServers(result, Date.now(), previous);
    for (const server of servers) {
      bindConnectionIdentity(new URL(server.url).origin, server.handle);
    }
    writeStoredServers(servers);
    return servers;
  } catch {
    return markRemotesOffline(previous);
  }
}

export async function fetchRemoteSnapshot(
  server: FederatedServer,
): Promise<RemoteSnapshotFetchResult> {
  try {
    const bootstrap = await getRemoteSdk(
      server.url,
    ).projects.sidebarBootstrap();
    const fetchedAt = Date.now();
    writeStoredSnapshot(server.handle, { fetchedAt, bootstrap });
    return { bootstrap, fetchedAt, reachable: true };
  } catch {
    const stored = readStoredSnapshot(server.handle);
    return {
      bootstrap: stored?.bootstrap ?? null,
      fetchedAt: stored?.fetchedAt ?? null,
      reachable: false,
    };
  }
}

export function useAccountServers(options?: { enabled?: boolean }) {
  const enabled = options?.enabled ?? true;
  const queryClient = useQueryClient();
  useEffect(() => {
    if (!enabled) return;
    const unsubscribe = wsManager.onPluginSignal((message) => {
      if (
        message.pluginId !== CONNECT_PLUGIN_ID ||
        message.channel !== "account-servers"
      )
        return;
      const result = listAccountServersResultSchema.safeParse(message.payload);
      if (!result.success) return;
      const previous =
        queryClient.getQueryData<FederatedServer[]>(accountServersQueryKey()) ??
        readStoredServers();
      const servers = toFederatedServers(result.data, Date.now(), previous);
      for (const server of servers)
        bindConnectionIdentity(new URL(server.url).origin, server.handle);
      writeStoredServers(servers);
      queryClient.setQueryData(accountServersQueryKey(), servers);
    });
    const onConnected = wsManager.onConnected(() => {
      void queryClient.invalidateQueries({
        queryKey: accountServersQueryKey(),
      });
    });
    return () => {
      unsubscribe();
      onConnected();
    };
  }, [enabled, queryClient]);
  return useQuery<FederatedServer[]>({
    queryKey: accountServersQueryKey(),
    queryFn: async () => {
      const before = queryClient.getQueryData<FederatedServer[]>(
        accountServersQueryKey(),
      );
      const result = await fetchAccountServers(before ?? readStoredServers());
      const current = queryClient.getQueryData<FederatedServer[]>(
        accountServersQueryKey(),
      );
      if (current && current !== before) {
        writeStoredServers(current);
        return current;
      }
      return result;
    },
    enabled,
    placeholderData: () => readStoredServers(),
    refetchInterval: ACCOUNT_SERVERS_REFETCH_MS,
    refetchOnWindowFocus: true,
    staleTime: ACCOUNT_SERVERS_REFETCH_MS,
    retry: false,
  });
}

function storedSnapshotResult(
  handle: string,
): RemoteSnapshotFetchResult | undefined {
  const stored = readStoredSnapshot(handle);
  return stored === null
    ? undefined
    : {
        bootstrap: stored.bootstrap,
        fetchedAt: stored.fetchedAt,
        reachable: false,
      };
}

function toSnapshot(
  server: FederatedServer,
  result: RemoteSnapshotFetchResult | undefined,
): RemoteServerSnapshot {
  const bootstrap = result?.bootstrap ?? null;
  const fetchedAt = result?.fetchedAt ?? null;
  const status = !server.live
    ? "offline"
    : result === undefined
      ? "loading"
      : result.reachable
        ? "live"
        : "offline";
  return { server, bootstrap, fetchedAt, status };
}

export function useRemoteServerSnapshots(
  servers: readonly FederatedServer[],
  enabled = true,
): RemoteServerSnapshot[] {
  const queryClient = useQueryClient();
  const remotes = useMemo(() => selectRemoteServers(servers), [servers]);
  useEffect(() => {
    if (!enabled) return;
    const stop = remotes
      .filter((server) => server.live)
      .map((server) =>
        subscribeRemoteSnapshot(queryClient, server.handle, server.url),
      );
    return () => stop.forEach((unsubscribe) => unsubscribe());
  }, [enabled, queryClient, remotes]);
  const results = useQueries({
    queries: remotes.map((server) => ({
      queryKey: remoteServerSnapshotQueryKey(server.handle),
      queryFn: () => fetchRemoteSnapshot(server),
      enabled: enabled && server.live,
      refetchInterval: 5 * 60_000,
      refetchOnWindowFocus: true,
      staleTime: REMOTE_SNAPSHOT_REFETCH_MS,
      retry: false,
      placeholderData: () => storedSnapshotResult(server.handle),
    })),
  });
  return remotes.map((server, index) =>
    toSnapshot(server, results[index]?.data),
  );
}

export interface FederatedRemotes {
  servers: FederatedServer[];
  remotes: RemoteServerSnapshot[];
}

const EMPTY_SERVERS: FederatedServer[] = [];

export function useFederatedRemotes(options?: {
  enabled?: boolean;
}): FederatedRemotes {
  const enabled = (options?.enabled ?? true) && workspaceEmbedding === null;
  const computers = useConnectedComputers(enabled);
  const servers = enabled ? computers : EMPTY_SERVERS;
  const remotes = useRemoteServerSnapshots(servers, enabled);
  return { servers, remotes };
}

export function useConnectedComputers(enabled = true): FederatedServer[] {
  const account = useAccountServers({ enabled });
  const ssh = useSshConnections(enabled);
  return useMemo(
    () => [
      ...(account.data ?? []),
      ...(ssh.data?.connections.flatMap((connection): FederatedServer[] =>
        connection.url === null
          ? []
          : [
              {
                handle: sshConnectionHandle(connection.alias),
                name: connection.alias,
                url: connection.url,
                live: connection.state === "ready" && !ssh.isError,
                lastSeenAt: ssh.dataUpdatedAt,
                home: false,
              },
            ],
      ) ?? []),
    ],
    [account.data, ssh.data, ssh.dataUpdatedAt, ssh.isError],
  );
}
