import { createContext, useContext, useMemo, type ReactNode } from "react";
import { LOCAL_CONTENT_TRANSPORT, type ContentTransport } from "@/lib/api";
import { createRemoteFetch } from "./remote-fetch";
import type { FederatedServer } from "@kaioken/client-core";
import type { BrowserBbSdk } from "@kaioken/sdk/browser";
import { getRemoteSdk } from "./remote-sdk";
import { sdk } from "@/lib/sdk";

const RemoteServerContext = createContext<FederatedServer | null>(null);

export function RemoteServerProvider({
  server,
  children,
}: {
  server: FederatedServer;
  children: ReactNode;
}) {
  return (
    <RemoteServerContext.Provider value={server}>
      {children}
    </RemoteServerContext.Provider>
  );
}

export function useRemoteServer(): FederatedServer | null {
  return useContext(RemoteServerContext);
}

export function useScopedSdk(): BrowserBbSdk {
  const server = useRemoteServer();
  return server === null ? sdk : getRemoteSdk(server.url);
}

export function useContentTransport(): ContentTransport {
  const server = useRemoteServer();
  const url = server?.url ?? null;
  return useMemo<ContentTransport>(() => {
    if (url === null) return LOCAL_CONTENT_TRANSPORT;
    const remoteFetch = createRemoteFetch();
    return {
      fetch: remoteFetch,
      resolveUrl: (relativeUrl) => new URL(relativeUrl, url).toString(),
      usesObjectUrls: true,
    };
  }, [url]);
}
