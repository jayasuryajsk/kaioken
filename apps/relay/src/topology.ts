export type RelayRole = "apex" | "server" | "share" | "single" | "unknown";

export interface RelayTopology {
  role: RelayRole;
  handle: string;
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

export function resolveTopology(url: URL, env: TopologyEnv): RelayTopology {
  const baseDomain = env.BASE_DOMAIN?.trim().toLowerCase() ?? "";
  const handle = env.HANDLE?.trim().toLowerCase() ?? "";
  const hostname = url.hostname.toLowerCase();
  if (baseDomain.length === 0 || handle.length === 0) {
    const origin = `${url.protocol}//${url.host}`;
    return {
      role: "single",
      handle: hostname.split(".")[0] ?? "kaioken",
      apexOrigin: origin,
      serverOrigin: origin,
      cookieDomain: hostname,
      target: null,
    };
  }
  const shared = {
    handle,
    apexOrigin: `https://${baseDomain}`,
    serverOrigin: `https://${handle}.${baseDomain}`,
    cookieDomain: `.${baseDomain}`,
  };
  if (hostname === baseDomain) {
    return { ...shared, role: "apex", target: null };
  }
  if (hostname === `${handle}.${baseDomain}`) {
    return { ...shared, role: "server", target: null };
  }
  const suffix = `.${baseDomain}`;
  if (hostname.endsWith(suffix)) {
    const label = hostname.slice(0, -suffix.length);
    const match = SHARE_PATTERN.exec(label);
    if (match !== null && match[1] === handle) {
      return { ...shared, role: "share", target: match[2] ?? null };
    }
  }
  return { ...shared, role: "unknown", target: null };
}

export function acceptsAccountApi(topology: RelayTopology): boolean {
  return topology.role === "apex" || topology.role === "single";
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
