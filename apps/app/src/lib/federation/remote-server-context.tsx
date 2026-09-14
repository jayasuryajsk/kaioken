import { createContext, useContext, type ReactNode } from "react";
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
