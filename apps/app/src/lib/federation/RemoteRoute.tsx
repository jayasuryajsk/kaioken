import type { FederatedServer } from "@kaioken/client-core";
import { RemoteServerProvider } from "./remote-server-context";
import { RemoteScopeProvider } from "./remote-scope";
import { useEffect, useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@kaioken/shared-ui/button";
import { useConnectedComputers } from "@/hooks/queries/federation-queries";
import { getRemoteSdk } from "./remote-sdk";
import {
  readConnectionIdentity,
  rememberConnectionIdentity,
} from "./connection-identities";

export function RemoteRoute({ children }: { children: ReactNode }) {
  const { handle } = useParams<{ handle: string }>();
  const computers = useConnectedComputers();
  const server = computers.find(
    (computer) => computer.handle === handle && !computer.home,
  );
  return server ? (
    <RemoteIdentity key={`${server.handle}:${server.url}`} server={server}>
      {children}
    </RemoteIdentity>
  ) : (
    <p className="p-6 text-sm text-muted-foreground" role="status">
      This computer is not available on your account.
    </p>
  );
}

function RemoteIdentity({
  server,
  children,
}: {
  server: FederatedServer;
  children: ReactNode;
}) {
  const origin = new URL(server.url).origin;
  const [expected, setExpected] = useState(() =>
    readConnectionIdentity(origin, server.handle),
  );
  const identity = useQuery({
    queryKey: ["connection", origin, "identity"],
    queryFn: async ({ signal }) => {
      const result = await getRemoteSdk(origin).experimental_connections.self({
        signal,
      });
      return result;
    },
    enabled: server.live,
    retry: false,
    staleTime: 30_000,
  });
  useEffect(() => {
    if (expected === null && identity.data) {
      rememberConnectionIdentity(origin, identity.data.serverId, server.handle);
      setExpected(identity.data.serverId);
    }
  }, [expected, identity.data, origin, server.handle]);
  const changed =
    expected !== null &&
    identity.data !== undefined &&
    expected !== identity.data.serverId;
  if (identity.data && !changed)
    return (
      <RemoteServerProvider server={server}>
        <RemoteScopeProvider server={server}>{children}</RemoteScopeProvider>
      </RemoteServerProvider>
    );
  return (
    <div
      className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-sm text-muted-foreground"
      role="status"
    >
      <p>
        {changed
          ? `${server.name} now points to a different Kaioken installation.`
          : !server.live
            ? `${server.name} is offline. Your tasks will be available when it reconnects.`
            : identity.isError
              ? `Could not reach ${server.name}. Check that Kaioken is running and signed in there.`
              : `Connecting to ${server.name}…`}
      </p>
      {changed ? (
        <Button
          variant="outline"
          onClick={() => {
            if (!identity.data) return;
            rememberConnectionIdentity(
              origin,
              identity.data.serverId,
              server.handle,
            );
            setExpected(identity.data.serverId);
          }}
        >
          Trust this computer
        </Button>
      ) : identity.isError && server.live ? (
        <Button variant="outline" onClick={() => void identity.refetch()}>
          Retry
        </Button>
      ) : null}
    </div>
  );
}
