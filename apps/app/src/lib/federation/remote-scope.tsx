import { useEffect, type ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { BrowserBbSdk } from "@kaioken/sdk/browser";
import type { RealtimeSubscriptionTarget } from "@kaioken/server-contract";
import type { FederatedServer } from "@kaioken/client-core";
import { createAppQueryClient } from "@/lib/query-client";
import { createRealtimeCacheEffects } from "@/hooks/realtime-cache-effects";
import { getRemoteSdk } from "./remote-sdk";

interface RemoteScopeRuntime {
  queryClient: QueryClient;
  sdk: BrowserBbSdk;
  connection: { connected: boolean };
}

const runtimes = new Map<string, RemoteScopeRuntime>();

function scopeKey(url: string): string {
  return url.replace(/\/$/u, "");
}

export function getRemoteScopeRuntime(url: string): RemoteScopeRuntime {
  const key = scopeKey(url);
  const existing = runtimes.get(key);
  if (existing !== undefined) return existing;
  const connection = { connected: false };
  const runtime: RemoteScopeRuntime = {
    connection,
    sdk: getRemoteSdk(key),
    queryClient: createAppQueryClient({
      shouldRefetchOnWindowFocus: () => !connection.connected,
    }),
  };
  runtimes.set(key, runtime);
  return runtime;
}

export function resetRemoteScopeRuntimesForTest(): void {
  for (const runtime of runtimes.values()) runtime.queryClient.clear();
  runtimes.clear();
}

export function subscribeRemoteRealtimeTarget(
  sdk: BrowserBbSdk,
  target: RealtimeSubscriptionTarget,
): () => void {
  const noop = () => {};
  switch (target.kind) {
    case "thread-detail":
      return sdk.subscribe({
        event: "thread:changed",
        threadId: target.threadId,
        callback: noop,
      });
    case "thread-list":
      return sdk.subscribe({ event: "thread:changed", callback: noop });
    case "project-detail":
      return sdk.subscribe({
        event: "project:changed",
        projectId: target.projectId,
        callback: noop,
      });
    case "project-list":
      return sdk.subscribe({ event: "project:changed", callback: noop });
    case "environment-detail":
      return sdk.subscribe({
        event: "environment:changed",
        environmentId: target.environmentId,
        callback: noop,
      });
    case "environment-list":
      return sdk.subscribe({ event: "environment:changed", callback: noop });
    case "host-list":
      return sdk.subscribe({ event: "host:changed", callback: noop });
    case "system":
      return sdk.subscribe({ event: "system:changed", callback: noop });
    default:
      return noop;
  }
}

function RemoteRealtimeBridge({ runtime }: { runtime: RemoteScopeRuntime }) {
  useEffect(() => {
    const effects = createRealtimeCacheEffects({
      queryClient: runtime.queryClient,
    });
    const offs = [
      runtime.sdk.subscribe({
        event: "thread:changed",
        callback: effects.handleChanged,
      }),
      runtime.sdk.subscribe({
        event: "project:changed",
        callback: effects.handleChanged,
      }),
      runtime.sdk.subscribe({
        event: "environment:changed",
        callback: effects.handleChanged,
      }),
      runtime.sdk.subscribe({
        event: "host:changed",
        callback: effects.handleChanged,
      }),
      runtime.sdk.subscribe({
        event: "system:changed",
        callback: effects.handleChanged,
      }),
    ];
    let disconnectedAt: number | null = null;
    offs.push(
      runtime.sdk.subscribe({
        event: "realtime:connection",
        callback: (event) => {
          runtime.connection.connected = event.state === "connected";
          if (event.state !== "connected") {
            disconnectedAt ??= Date.now();
            return;
          }
          effects.handleConnected(
            event.reconnected
              ? {
                  reconnected: true,
                  disconnectedAt: disconnectedAt ?? Date.now(),
                }
              : { reconnected: false },
          );
          disconnectedAt = null;
        },
      }),
    );
    return () => {
      effects.dispose();
      for (const off of offs) off();
    };
  }, [runtime]);
  return null;
}

export function RemoteScopeProvider({
  server,
  children,
}: {
  server: FederatedServer;
  children: ReactNode;
}) {
  const runtime = getRemoteScopeRuntime(server.url);
  return (
    <QueryClientProvider client={runtime.queryClient}>
      <RemoteRealtimeBridge runtime={runtime} />
      {children}
    </QueryClientProvider>
  );
}
