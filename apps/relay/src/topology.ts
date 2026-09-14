import { isValidHandle } from "./store.js";

export type RelayRole = "apex" | "server" | "share" | "single" | "unknown";

export interface RelayTopology {
  role: RelayRole;
  handle: string;
  baseDomain: string | null;
  apexOrigin: string;
  serverOrigin: string;
  cookieDomain: string;
  target: string | null;
}

export interface TopologyEnv {
  BASE_DOMAIN?: string;
  HANDLE?: string;
}

const SHARE_PATTERN = /^([a-z0-9-]+?)--(\d{1,5})$/u;

export function defaultHandle(env: TopologyEnv): string {
  const handle = env.HANDLE?.trim().toLowerCase() ?? "";
  return handle.length > 0 ? handle : "kaioken";
}

export function resolveTopology(url: URL, env: TopologyEnv): RelayTopology {
  const baseDomain = env.BASE_DOMAIN?.trim().toLowerCase() ?? "";
  const hostname = url.hostname.toLowerCase();
  if (baseDomain.length === 0) {
    const origin = `${url.protocol}//${url.host}`;
    return {
      role: "single",
      handle: hostname.split(".")[0] ?? "kaioken",
      baseDomain: null,
      apexOrigin: origin,
      serverOrigin: origin,
      cookieDomain: hostname,
      target: null,
    };
  }
  const forHandle = (handle: string) => ({
    handle,
    baseDomain,
    apexOrigin: `https://${baseDomain}`,
    serverOrigin: `https://${handle}.${baseDomain}`,
    cookieDomain: `.${baseDomain}`,
  });
  if (hostname === baseDomain) {
    return { ...forHandle(defaultHandle(env)), role: "apex", target: null };
  }
  const suffix = `.${baseDomain}`;
  if (!hostname.endsWith(suffix)) {
    return { ...forHandle(defaultHandle(env)), role: "unknown", target: null };
  }
  const label = hostname.slice(0, -suffix.length);
  if (isValidHandle(label)) {
    return { ...forHandle(label), role: "server", target: null };
  }
  const match = SHARE_PATTERN.exec(label);
  if (match !== null && match[1] !== undefined && isValidHandle(match[1])) {
    return { ...forHandle(match[1]), role: "share", target: match[2] ?? null };
  }
  return { ...forHandle(defaultHandle(env)), role: "unknown", target: null };
}

export function acceptsAccountApi(topology: RelayTopology): boolean {
  return (
    topology.role === "apex" ||
    topology.role === "server" ||
    topology.role === "single"
  );
}

export function acceptsTunnel(topology: RelayTopology): boolean {
  return topology.role === "server" || topology.role === "single";
}

export function acceptsVisitors(topology: RelayTopology): boolean {
  return (
    topology.role === "server" ||
    topology.role === "share" ||
    topology.role === "single"
  );
}

export function corsOriginFor(
  origin: string | null,
  topology: RelayTopology,
): string | null {
  if (origin === null) return null;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:") return null;
  if (topology.baseDomain === null) {
    return origin === topology.serverOrigin ? origin : null;
  }
  const host = parsed.host.toLowerCase();
  if (host === topology.baseDomain) return origin;
  if (!host.endsWith(`.${topology.baseDomain}`)) return null;
  const label = host.slice(0, -(topology.baseDomain.length + 1));
  return isValidHandle(label) || SHARE_PATTERN.test(label) ? origin : null;
}
