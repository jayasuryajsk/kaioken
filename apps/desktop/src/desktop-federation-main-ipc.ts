import { ipcMain } from "electron";
import {
  KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_BODY_BYTES,
  kaiokenDesktopFederatedFetchRequestSchema,
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
    method: "GET" | "HEAD";
    headers: Record<string, string>;
    credentials: "include";
  },
) => Promise<{
  status: number;
  headers: { forEach(callback: (value: string, key: string) => void): void };
  text(): Promise<string>;
}>;

function parentDomain(hostname: string): string | null {
  const labels = hostname.split(".");
  return labels.length >= 3 ? labels.slice(1).join(".") : null;
}

export function isAllowedFederatedUrl(
  url: URL,
  servers: readonly FederatedFetchServer[],
): boolean {
  if (url.protocol !== "https:") return false;
  for (const server of servers) {
    let known: URL;
    try {
      known = new URL(server.url);
    } catch {
      continue;
    }
    if (known.protocol !== "https:") continue;
    if (known.origin === url.origin) return true;
    const domain = parentDomain(known.hostname);
    if (domain !== null && url.hostname.endsWith(`.${domain}`)) return true;
  }
  return false;
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
  maxBodyBytes?: number;
}

export function createFederatedFetchHandler({
  listServers,
  fetchImpl,
  maxBodyBytes = KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_BODY_BYTES,
}: CreateFederatedFetchHandlerArgs): (
  payload: unknown,
) => Promise<KaiokenDesktopFederatedFetchResponse> {
  return async (payload) => {
    const parsed = kaiokenDesktopFederatedFetchRequestSchema.safeParse(payload);
    if (!parsed.success) {
      throw new Error("federated fetch request is malformed");
    }
    const url = new URL(parsed.data.url);
    if (!isAllowedFederatedUrl(url, listServers())) {
      throw new Error(`federated fetch refused for ${url.origin}`);
    }
    const response = await fetchImpl(url.toString(), {
      method: parsed.data.method,
      headers: sanitizeFederatedHeaders(parsed.data.headers),
      credentials: "include",
    });
    const body = parsed.data.method === "HEAD" ? "" : await response.text();
    if (Buffer.byteLength(body, "utf8") > maxBodyBytes) {
      throw new Error("federated fetch response exceeds the size limit");
    }
    const headers: Array<[string, string]> = [];
    response.headers.forEach((value, key) => {
      if (key.toLowerCase() === "set-cookie") return;
      headers.push([key, value]);
    });
    return { status: response.status, headers, body };
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
