import { ipcMain } from "electron";
import {
  KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_BODY_BYTES,
  KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_REQUEST_BODY_BYTES,
  kaiokenDesktopFederatedFetchRequestSchema,
  type KaiokenDesktopFederatedFetchMethod,
  type KaiokenDesktopFederatedFetchResponse,
} from "@kaioken/desktop-contract";
import { KAIOKEN_DESKTOP_FEDERATED_FETCH_CHANNEL } from "./desktop-federation-ipc.js";

const BLOCKED_REQUEST_HEADERS = new Set([
  "authorization",
  "cookie",
  "host",
  "x-bb-connect-machine",
]);

export interface FederatedFetchServer {
  url: string;
}

export type FederatedFetchImpl = (
  url: string,
  init: {
    method: KaiokenDesktopFederatedFetchMethod;
    headers: Record<string, string>;
    credentials: "include";
    body?: string | Uint8Array<ArrayBuffer>;
    redirect: "error";
  },
) => Promise<{
  status: number;
  headers: { forEach(callback: (value: string, key: string) => void): void };
  text(): Promise<string>;
  arrayBuffer(): Promise<ArrayBuffer>;
}>;

export function isAllowedFederatedUrl(
  url: URL,
  servers: readonly FederatedFetchServer[],
): boolean {
  const loopback =
    url.protocol === "http:" &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if ((url.protocol !== "https:" && !loopback) || url.username || url.password)
    return false;
  return servers.some((server) => {
    try {
      return new URL(server.url).origin === url.origin;
    } catch {
      return false;
    }
  });
}

export function sanitizeFederatedHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const sanitized: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (BLOCKED_REQUEST_HEADERS.has(lower)) continue;
    sanitized[lower] = value;
  }
  return sanitized;
}

export interface CreateFederatedFetchHandlerArgs {
  listServers: () => readonly FederatedFetchServer[];
  fetchImpl: FederatedFetchImpl;
  prepare?: () => Promise<void>;
  maxBodyBytes?: number;
  maxRequestBodyBytes?: number;
}

export function createFederatedFetchHandler({
  listServers,
  fetchImpl,
  prepare,
  maxBodyBytes = KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_BODY_BYTES,
  maxRequestBodyBytes = KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_REQUEST_BODY_BYTES,
}: CreateFederatedFetchHandlerArgs): (
  payload: unknown,
) => Promise<KaiokenDesktopFederatedFetchResponse> {
  return async (payload) => {
    const parsed = kaiokenDesktopFederatedFetchRequestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("federated fetch request is malformed");
    }
    const requestBody =
      parsed.data.body !== undefined && parsed.data.bodyEncoding === "base64"
        ? Buffer.from(parsed.data.body, "base64")
        : parsed.data.body;
    if (
      requestBody !== undefined &&
      Buffer.byteLength(requestBody, "utf8") > maxRequestBodyBytes
    ) {
      throw new Error("federated fetch request body exceeds the size limit");
    }
    if (prepare !== undefined) {
      try {
        await prepare();
      } catch {
        return {
          status: 401,
          headers: [],
          body: "Connection sign-in required",
        };
      }
    }
    const url = new URL(parsed.data.url);
    if (!isAllowedFederatedUrl(url, listServers())) {
      throw new Error(`federated fetch refused for ${url.origin}`);
    }
    const headers = sanitizeFederatedHeaders(parsed.data.headers);
    if (requestBody !== undefined && headers["content-type"] === undefined) {
      headers["content-type"] = "application/json";
    }
    const response = await fetchImpl(url.toString(), {
      method: parsed.data.method,
      headers,
      credentials: "include",
      redirect: "error",
      ...(requestBody === undefined ? {} : { body: requestBody }),
    });
    const bytes =
      parsed.data.method === "HEAD"
        ? Buffer.alloc(0)
        : Buffer.from(await response.arrayBuffer());
    if (bytes.byteLength > maxBodyBytes) {
      throw new Error("federated fetch response exceeds the size limit");
    }
    const responseHeaders: Array<[string, string]> = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return;
      responseHeaders.push([key, value]);
    });
    return parsed.data.responseEncoding === "base64"
      ? {
          status: response.status,
          headers: responseHeaders,
          body: bytes.toString("base64"),
          bodyEncoding: "base64",
        }
      : {
          status: response.status,
          headers: responseHeaders,
          body: bytes.toString("utf8"),
        };
  };
}

export function registerDesktopFederationIpc(
  args: CreateFederatedFetchHandlerArgs,
): void {
  const handler = createFederatedFetchHandler(args);
  ipcMain.handle(KAIOKEN_DESKTOP_FEDERATED_FETCH_CHANNEL, (_event, payload) =>
    handler(payload),
  );
}
