import { useQuery } from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";

export function remoteHostsQueryKey(handle: string) {
  return ["federation", "hosts", handle] as const;
}

export function remoteComposeOptionsQueryKey(
  handle: string,
  hostId: string | null,
  providerId: string | null,
) {
  return ["federation", "compose-options", handle, hostId, providerId] as const;
}

export function useRemoteHosts(server: FederatedServer | undefined) {
  const enabled = server !== undefined && server.live;
  return useQuery({
    queryKey: remoteHostsQueryKey(server?.handle ?? ""),
    queryFn: () => getRemoteSdk(server?.url ?? "").hosts.list(),
    enabled,
    staleTime: 60_000,
    retry: false,
  });
}

export function useRemoteComposeOptions(
  server: FederatedServer | undefined,
  hostId: string | null,
  providerId: string | null,
) {
  const enabled = server !== undefined && server.live;
  return useQuery({
    queryKey: remoteComposeOptionsQueryKey(
      server?.handle ?? "",
      hostId,
      providerId,
    ),
    queryFn: () =>
      getRemoteSdk(server?.url ?? "").system.executionOptions({
        ...(hostId === null ? {} : { hostId }),
        ...(providerId === null ? {} : { providerId }),
      }),
    enabled,
    placeholderData: (previous) => previous,
    staleTime: 60_000,
    retry: false,
  });
}
