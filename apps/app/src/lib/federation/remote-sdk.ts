import { createBrowserBbSdk, type BrowserBbSdk } from "@kaioken/sdk/browser";
import { createRemoteFetch } from "./remote-fetch";

const clients = new Map<string, BrowserBbSdk>();

export function getRemoteSdk(serverUrl: string): BrowserBbSdk {
  const key = serverUrl.replace(/\/$/u, "");
  const existing = clients.get(key);
  if (existing !== undefined) return existing;
  const created = createBrowserBbSdk({
    baseUrl: key,
    fetch: createRemoteFetch(),
  });
  clients.set(key, created);
  return created;
}

export function resetRemoteSdkForTest(): void {
  clients.clear();
}
