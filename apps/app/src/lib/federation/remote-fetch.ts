import type { KaiokenDesktopFederatedFetchRequest } from "@kaioken/desktop-contract";
import { getBbDesktopInfo } from "@/lib/kaioken-desktop";

const READ_METHODS = new Set(["GET", "HEAD"]);

function headersToRecord(
  headers: HeadersInit | undefined,
): Record<string, string> {
  const record: Record<string, string> = {};
  if (headers === undefined) return record;
  new Headers(headers).forEach((value, key) => {
    record[key] = value;
  });
  return record;
}

export type RemoteFetchMode = "desktop-bridge" | "browser-cookie";

export function resolveRemoteFetchMode(): RemoteFetchMode {
  return getBbDesktopInfo()?.federatedFetch === undefined
    ? "browser-cookie"
    : "desktop-bridge";
}

export function createRemoteFetch(
  mode = resolveRemoteFetchMode(),
): typeof fetch {
  if (mode === "browser-cookie") {
    return (input, init) =>
      fetch(input, { ...init, credentials: "include", mode: "cors" });
  }
  return async (input, init) => {
    const bridge = getBbDesktopInfo()?.federatedFetch;
    if (bridge === undefined) {
      return fetch(input, { ...init, credentials: "include", mode: "cors" });
    }
    const method = (init?.method ?? "GET").toUpperCase();
    if (!READ_METHODS.has(method)) {
      throw new Error(`Remote Kaioken servers are read-only (${method})`);
    }
    const request: KaiokenDesktopFederatedFetchRequest = {
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      method: method === "HEAD" ? "HEAD" : "GET",
      headers: headersToRecord(init?.headers),
    };
    const response = await bridge(request);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}
