import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { updateSshTargets } from "@/lib/federation/ssh-targets";
import { invalidateSshConnections } from "../cache-owners/connection-cache-owner";
import { sshConnectionsQueryKey } from "./query-keys";

export const canControlLocalSsh =
  typeof window !== "undefined" &&
  ["localhost", "127.0.0.1", "[::1]"].includes(window.location.hostname);

export function useSshConnections(enabled = true) {
  return useQuery({
    queryKey: sshConnectionsQueryKey(),
    queryFn: async ({ signal }) => {
      const result = await sdk.experimental_connections.ssh.list({ signal });
      updateSshTargets(result.connections);
      return result;
    },
    enabled: enabled && canControlLocalSsh,
    retry: false,
    refetchInterval: (query) =>
      query.state.data?.connections.some((connection) =>
        ["connecting", "reconnecting"].includes(connection.state),
      )
        ? 2000
        : 15_000,
    staleTime: 2000,
  });
}

export function useSshConnectionActions() {
  const client = useQueryClient();
  const refresh = () => invalidateSshConnections(client);
  const connect = useMutation({
    mutationFn: (alias: string) =>
      sdk.experimental_connections.ssh.connect({ alias }),
    onSuccess: refresh,
  });
  const disconnect = useMutation({
    mutationFn: (alias: string) =>
      sdk.experimental_connections.ssh.disconnect({ alias }),
    onSuccess: refresh,
  });
  return { connect, disconnect };
}

export function sshConnectionHandle(alias: string): string {
  return `ssh.${alias}`;
}
