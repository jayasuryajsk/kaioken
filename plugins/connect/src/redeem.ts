export const DEFAULT_CONNECT_BASE_URL = "https://kaioken.app";

export function resolveDefaultConnectBaseUrl(env: NodeJS.ProcessEnv): string {
  const configured = env.KAIOKEN_DEV_CONNECT_BASE_URL?.trim();
  if (env.NODE_ENV !== "development" || !configured) {
    return DEFAULT_CONNECT_BASE_URL;
  }

  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    throw new Error(
      "KAIOKEN_DEV_CONNECT_BASE_URL must be an http://kaioken.localhost:<port> origin",
    );
  }
  if (
    url.protocol !== "http:" ||
    url.hostname !== "kaioken.localhost" ||
    url.port.length === 0 ||
    url.username.length > 0 ||
    url.password.length > 0 ||
    (url.pathname !== "" && url.pathname !== "/") ||
    url.search.length > 0 ||
    url.hash.length > 0
  ) {
    throw new Error(
      "KAIOKEN_DEV_CONNECT_BASE_URL must be an http://kaioken.localhost:<port> origin",
    );
  }
  return url.origin;
}

interface RedeemedCredential {
  credential: string;
  handle: string;
}

export const CONNECT_HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;

export function slugifyConnectHandle(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/\.local$/u, "")
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 32)
    .replace(/-+$/u, "");
  return CONNECT_HANDLE_PATTERN.test(slug) ? slug : "kaioken";
}

type ConnectPairErrorCode =
  | "invalid_code"
  | "expired_code"
  | "already_used"
  | "network";

export class ConnectPairError extends Error {
  constructor(
    readonly code: ConnectPairErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ConnectPairError";
  }
}

function pairErrorCodeForRedeem(
  status: number,
  wireError: string | undefined,
): ConnectPairErrorCode {
  const detail = (wireError ?? "").toLowerCase();
  if (detail.includes("expired") || status === 410) return "expired_code";
  if (
    detail.includes("already") ||
    detail.includes("used") ||
    detail.includes("redeemed") ||
    status === 409
  ) {
    return "already_used";
  }
  if (status >= 500) return "network";
  return "invalid_code";
}

export function asConnectPairError(error: unknown): ConnectPairError {
  if (error instanceof ConnectPairError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ConnectPairError("network", message);
}

export async function redeemConnectCode(args: {
  code: string;
  baseUrl: string;
  handle?: string;
  name?: string;
}): Promise<RedeemedCredential> {
  const res = await fetch(`${args.baseUrl}/api/connect/redeem`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      code: args.code,
      ...(args.handle !== undefined ? { handle: args.handle } : {}),
      ...(args.name !== undefined ? { name: args.name } : {}),
    }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new ConnectPairError(
      pairErrorCodeForRedeem(res.status, body.error),
      `Redeem failed (${res.status})${body.error ? `: ${body.error}` : ""}`,
    );
  }
  const data = (await res.json()) as RedeemedCredential;
  return { credential: data.credential, handle: data.handle };
}
