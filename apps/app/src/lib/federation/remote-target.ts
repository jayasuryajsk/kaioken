import { useMemo } from "react";
import { parseRemoteId, type FederatedServer } from "@kaioken/client-core";
import { useAccountServers } from "@/hooks/queries/federation-queries";

export interface RemoteTarget {
  server: FederatedServer;
  id: string;
}

export function isRemoteId(id: string | null | undefined): boolean {
  return Boolean(id) && parseRemoteId(id ?? "") !== null;
}

export function resolveRemoteTarget(
  servers: readonly FederatedServer[] | undefined,
  id: string | null | undefined,
): RemoteTarget | null {
  if (!id) return null;
  const parsed = parseRemoteId(id);
  if (parsed === null) return null;
  const server = servers?.find(
    (candidate) => candidate.handle === parsed.handle && !candidate.home,
  );
  return server === undefined ? null : { server, id: parsed.id };
}

export function useRemoteTarget(
  id: string | null | undefined,
): RemoteTarget | null {
  const servers = useAccountServers({ enabled: isRemoteId(id) });
  return useMemo(
    () => resolveRemoteTarget(servers.data, id),
    [id, servers.data],
  );
}
