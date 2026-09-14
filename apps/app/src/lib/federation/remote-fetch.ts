import {
  kaiokenDesktopFederatedFetchMethods,
  type KaiokenDesktopFederatedFetchMethod,
  type KaiokenDesktopFederatedFetchRequest,
} from "@kaioken/desktop-contract";
import { getBbDesktopInfo } from "@/lib/kaioken-desktop";

const BRIDGE_METHODS: ReadonlySet<string> = new Set(
  kaiokenDesktopFederatedFetchMethods,
);

function isBridgeMethod(
  method: string,
): method is KaiokenDesktopFederatedFetchMethod {
  return BRIDGE_METHODS.has(method);
}

function bridgeBody(body: BodyInit | null | undefined): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  throw new Error(
    "Remote Kaioken requests through the desktop bridge must carry a text body",
  );
}

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
    if (!isBridgeMethod(method)) {
      throw new Error(
        `Remote Kaioken requests through the desktop bridge cannot use ${method}`,
      );
    }
    const body = bridgeBody(init?.body);
    const request: KaiokenDesktopFederatedFetchRequest = {
      url:
        typeof input === "string"
          ? input
          : input instanceof URL
            ? input.toString()
            : input.url,
      method,
      headers: headersToRecord(init?.headers),
      ...(body === undefined ? {} : { body }),
    };
    const response = await bridge(request);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  };
}
