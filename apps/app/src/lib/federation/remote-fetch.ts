import {
  kaiokenDesktopFederatedFetchMethods,
  type KaiokenDesktopFederatedFetchMethod,
  type KaiokenDesktopFederatedFetchRequest,
} from "@kaioken/desktop-contract";
import { getBbDesktopInfo } from "@/lib/kaioken-desktop";
import { sshHttpResponseSchema } from "@kaioken/host-daemon-contract";
import { sshAliasForOrigin } from "./ssh-targets";
import { readConnectionIdentity } from "./connection-identities";
import { CONNECTION_IDENTITY_HEADER } from "@kaioken/server-contract";
import { fetchWithAppSurface } from "../app-surface";

const BRIDGE_METHODS: ReadonlySet<string> = new Set(
  kaiokenDesktopFederatedFetchMethods,
);

function isBridgeMethod(
  method: string,
): method is KaiokenDesktopFederatedFetchMethod {
  return BRIDGE_METHODS.has(method);
}

function encodeBytes(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decodeBytes(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function withAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    operation.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
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
  const direct = createDirectRemoteFetch(mode);
  return async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    const expectedIdentity = readConnectionIdentity(url.origin);
    if (expectedIdentity && url.pathname !== "/api/v1/connections/self")
      request.headers.set(CONNECTION_IDENTITY_HEADER, expectedIdentity);
    const alias =
      mode === "browser-cookie" ? sshAliasForOrigin(url.origin) : null;
    if (alias === null) return direct(request);
    request.signal.throwIfAborted();
    const body =
      request.body === null
        ? null
        : encodeBytes(new Uint8Array(await request.arrayBuffer()));
    const response = await fetchWithAppSurface(
      "/api/v1/connections/ssh/request",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal: request.signal,
        body: JSON.stringify({
          alias,
          path: `${url.pathname}${url.search}`,
          method: request.method,
          headers: headersToRecord(request.headers),
          body,
        }),
      },
    );
    if (!response.ok) return response;
    const remote = sshHttpResponseSchema.parse(await response.json());
    return new Response(
      request.method === "HEAD" || [204, 205, 304].includes(remote.status)
        ? null
        : decodeBytes(remote.body),
      { status: remote.status, headers: remote.headers },
    );
  };
}

function createDirectRemoteFetch(mode: RemoteFetchMode): typeof fetch {
  if (mode === "browser-cookie") {
    return (input, init) =>
      fetch(input, { ...init, credentials: "include", mode: "cors" });
  }
  return async (input, init) => {
    const bridge = getBbDesktopInfo()?.federatedFetch;
    if (bridge === undefined) {
      return fetch(input, { ...init, credentials: "include", mode: "cors" });
    }
    const method = (
      init?.method ?? (input instanceof Request ? input.method : "GET")
    ).toUpperCase();
    if (!isBridgeMethod(method)) {
      throw new Error(
        `Remote Kaioken requests through the desktop bridge cannot use ${method}`,
      );
    }
    const request = new Request(input, init);
    request.signal.throwIfAborted();
    const supportsBinary = getBbDesktopInfo()?.federatedTransportVersion === 2;
    const body =
      request.body === null
        ? undefined
        : supportsBinary
          ? encodeBytes(new Uint8Array(await request.arrayBuffer()))
          : await request.text();
    request.signal.throwIfAborted();
    if (
      !supportsBinary &&
      body !== undefined &&
      !request.headers
        .get("content-type")
        ?.match(
          /^(application\/json|text\/|application\/x-www-form-urlencoded)/u,
        )
    ) {
      throw new Error(
        "Update the desktop app to upload files to another computer",
      );
    }
    const payload: KaiokenDesktopFederatedFetchRequest = {
      url: request.url,
      method,
      headers: headersToRecord(request.headers),
      ...(body === undefined ? {} : { body }),
      ...(supportsBinary
        ? {
            responseEncoding: "base64",
            ...(body === undefined ? {} : { bodyEncoding: "base64" }),
          }
        : {}),
    };
    const response = await withAbort(bridge(payload), request.signal);
    if (response.status === 0) {
      throw new Error("The remote connection is unavailable");
    }
    const responseBody =
      method === "HEAD" || [204, 205, 304].includes(response.status)
        ? null
        : response.bodyEncoding === "base64"
          ? decodeBytes(response.body)
          : response.body;
    return new Response(responseBody, {
      status: response.status,
      headers: response.headers,
    });
  };
}
