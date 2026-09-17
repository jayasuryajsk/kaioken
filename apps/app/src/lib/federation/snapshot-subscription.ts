import type { QueryClient } from "@tanstack/react-query";
import { getRemoteSdk } from "./remote-sdk";

const subscriptions = new WeakMap<
  QueryClient,
  Map<string, { count: number; dispose: () => void }>
>();

export function subscribeRemoteSnapshot(
  client: QueryClient,
  handle: string,
  url: string,
): () => void {
  let entries = subscriptions.get(client);
  if (!entries) {
    entries = new Map();
    subscriptions.set(client, entries);
  }
  const key = `${handle}:${url}`;
  let entry = entries.get(key);
  if (!entry) {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const refresh = () => {
      if (timer !== undefined) return;
      timer = setTimeout(() => {
        timer = undefined;
        void client.invalidateQueries(
          { queryKey: ["federation", "snapshot", handle] },
          { cancelRefetch: false },
        );
      }, 300);
    };
    const sdk = getRemoteSdk(url);
    const stop = [
      sdk.subscribe({ event: "thread:changed", callback: refresh }),
      sdk.subscribe({ event: "project:changed", callback: refresh }),
      sdk.subscribe({ event: "host:changed", callback: refresh }),
      sdk.subscribe({
        event: "realtime:connection",
        callback: (event) => {
          if (event.state === "connected") refresh();
        },
      }),
    ];
    entry = {
      count: 0,
      dispose: () => {
        clearTimeout(timer);
        stop.forEach((unsubscribe) => unsubscribe());
      },
    };
    entries.set(key, entry);
  }
  entry.count += 1;
  return () => {
    entry.count -= 1;
    if (entry.count === 0) {
      entry.dispose();
      entries.delete(key);
    }
  };
}
