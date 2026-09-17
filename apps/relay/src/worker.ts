import { TUNNEL_OFFLINE_HEADER, TunnelDO, type Env } from "./tunnel-do.js";
import { PairingLimiter } from "./pairing-limiter.js";
import type { TunnelStatus } from "./tunnel-do.js";
import {
  API_SESSION_TTL_MS,
  BROWSER_SESSION_TTL_MS,
  SESSION_COOKIE_NAME,
  constantTimeEqual,
  createSessionCookie,
  normalizePairingCode,
  parseCookie,
  randomPairingCode,
  randomToken,
  sha256Hex,
  verifySessionCookie,
} from "./auth.js";
import { MACHINE_CODE_TTL_MS, RelayStore, isValidHandle } from "./store.js";
import {
  acceptsAccountApi,
  acceptsTunnel,
  acceptsVisitors,
  corsOriginFor,
  defaultHandle,
  resolveTopology,
  type RelayTopology,
} from "./topology.js";
import { serveWithCache } from "./cache.js";
import { KAIOKEN_ICON_DATA_URI } from "./kaioken-icon.js";
import {
  GATE_AUTH_HEADER,
  GATE_MACHINE_ID_HEADER,
  MACHINE_CREDENTIAL_HEADER,
  TUNNEL_TARGET_HEADER,
} from "./protocol-headers.js";

export { TunnelDO, PairingLimiter };

const SERVER_OFFLINE_AFTER_MS = 90_000;
const CORS_METHODS = "GET, POST, PATCH, PUT, DELETE, OPTIONS";
const CORS_HEADERS = `content-type, authorization, ${MACHINE_CREDENTIAL_HEADER}, x-requested-with, accept, cache-control, if-none-match`;

function corsHeadersFor(
  request: Request,
  topology: RelayTopology,
): Record<string, string> | null {
  const origin = corsOriginFor(request.headers.get("origin"), topology);
  if (origin === null) return null;
  const requested = request.headers.get("access-control-request-headers");
  return {
    "access-control-allow-origin": origin,
    "access-control-allow-credentials": "true",
    "access-control-allow-methods": CORS_METHODS,
    "access-control-allow-headers":
      requested !== null && requested.length > 0
        ? `${CORS_HEADERS}, ${requested}`
        : CORS_HEADERS,
    "access-control-expose-headers": "etag, content-type",
    vary: "Origin",
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function isTrustedUpgradeOrigin(
  origin: string | null,
  topology: RelayTopology,
): boolean {
  if (origin === null || origin.length === 0) return true;
  let parsed: URL;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  if (
    LOOPBACK_HOSTS.has(parsed.hostname) ||
    parsed.hostname.endsWith(".localhost")
  ) {
    return true;
  }
  return corsOriginFor(origin, topology) !== null;
}

function withCors(
  response: Response,
  cors: Record<string, string> | null,
): Response {
  if (cors === null || response.status === 101 || response.webSocket) {
    return response;
  }
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(cors)) headers.set(name, value);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function text(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      ...headers,
    },
  });
}

function methodNotAllowed(allow: string): Response {
  return json({ error: "method_not_allowed" }, 405, { allow });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

const GATE_STYLE = `
  :root{--canvas:oklch(1 0 0);--ink:oklch(0.3211 0 0);
    --muted:color-mix(in oklch,var(--ink) 55%,var(--canvas));
    --border:color-mix(in oklch,var(--ink) 14%,var(--canvas));
    --card:color-mix(in oklch,var(--ink) 2%,var(--canvas));}
  @media (prefers-color-scheme:dark){:root{--canvas:oklch(0.195 0 0);--ink:oklch(0.81 0 0)}}
  *{box-sizing:border-box}
  body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;
    background:var(--canvas);color:var(--ink);
    font:15px/1.6 -apple-system,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
  .wrap{width:100%;max-width:420px;padding:24px}
  .brand{display:flex;align-items:center;gap:10px;margin-bottom:18px}
  .brand img{width:28px;height:28px}
  .brand b{font-weight:600;font-size:15px}
  .card{border:1px solid var(--border);background:var(--card);border-radius:12px;padding:22px 24px}
  h1{margin:0 0 4px;font-size:18px;font-weight:600}
  p{margin:0 0 16px;color:var(--muted);font-size:14px}
  input{width:100%;padding:11px 12px;border-radius:8px;border:1px solid var(--border);
    background:var(--canvas);color:var(--ink);font:500 18px/1 ui-monospace,monospace;
    letter-spacing:.12em;text-transform:uppercase;margin-bottom:12px}
  .btn{display:flex;align-items:center;justify-content:center;width:100%;padding:11px 16px;
    border-radius:8px;border:1px solid var(--ink);background:var(--ink);color:var(--canvas);
    font:500 14px/1 -apple-system,system-ui,sans-serif;cursor:pointer}
  .err{color:oklch(0.62 0.2 25);font-size:13px;margin:-6px 0 12px}
`;

function gatePage(
  cardBody: string,
  status: number,
  metaRefreshSeconds?: number,
): Response {
  const refresh =
    metaRefreshSeconds !== undefined
      ? `<meta http-equiv="refresh" content="${metaRefreshSeconds}">`
      : "";
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8">
     <meta name="viewport" content="width=device-width, initial-scale=1">
     ${refresh}<title>Kaioken relay</title><style>${GATE_STYLE}</style></head>
     <body><div class="wrap">
       <div class="brand"><img src="${KAIOKEN_ICON_DATA_URI}" alt=""><b>Kaioken relay</b></div>
       <div class="card">${cardBody}</div>
     </div></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8" } },
  );
}

export function signInPage(error: string | null): Response {
  return gatePage(
    `<h1>Enter a pairing code</h1>
     <p>Open Kaioken on your Mac, go to Settings → Connect, and generate a phone pairing code.</p>
     <form method="post" action="/__login">
       <input name="code" placeholder="XXXX-XXXX" autocomplete="one-time-code" autofocus>
       ${error ? `<div class="err">${escapeHtml(error)}</div>` : ""}
       <button class="btn" type="submit">Open Kaioken</button>
     </form>`,
    error ? 400 : 401,
  );
}

export function relativeTime(then: number, now: number = Date.now()): string {
  const minutes = Math.floor(Math.max(0, now - then) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  return new Date(then).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}

export function offlinePage(lastSeenAt: number | null): Response {
  const lastSeen = lastSeenAt ? `Last seen ${relativeTime(lastSeenAt)}. ` : "";
  return gatePage(
    `<h1>Your Kaioken is offline</h1>
     <p>${lastSeen}This page retries automatically when it comes back. Usually the Mac is asleep or Kaioken isn't running.</p>
     <button class="btn" onclick="location.reload()">Retry now</button>`,
    503,
    10,
  );
}

function wantsHtml(request: Request): boolean {
  return (request.headers.get("accept") ?? "").includes("text/html");
}

const PUBLIC_INSTALL_PATHS = new Set([
  "/install.sh",
  "/install/version",
  "/install/kaioken-app.tgz",
]);

function isMachinePath(pathname: string): boolean {
  return (
    pathname.startsWith("/internal") ||
    pathname === "/api/v1" ||
    pathname.startsWith("/api/v1/")
  );
}

function isHostManagementMutation(request: Request, pathname: string): boolean {
  if (request.method === "POST" && pathname === "/internal/hosts/enroll-key") {
    return true;
  }
  if (request.method === "POST" && pathname === "/api/v1/hosts/join-codes") {
    return true;
  }
  if (
    request.method === "PATCH" &&
    /^\/api\/v1\/hosts\/[^/]+\/permission-ceiling$/u.test(pathname)
  ) {
    return true;
  }
  return (
    (request.method === "PATCH" || request.method === "DELETE") &&
    /^\/api\/v1\/hosts\/[^/]+$/u.test(pathname)
  );
}

export function requestForTunnelDo(
  request: Request,
  target: string | null,
  machineId?: string,
  authKind: "session" | "machine" | null = "session",
): Request {
  const headers = new Headers(request.headers);
  headers.delete(TUNNEL_TARGET_HEADER);
  headers.delete(MACHINE_CREDENTIAL_HEADER);
  headers.delete(GATE_AUTH_HEADER);
  headers.delete(GATE_MACHINE_ID_HEADER);
  if (target !== null) headers.set(TUNNEL_TARGET_HEADER, target);
  if (authKind !== null) headers.set(GATE_AUTH_HEADER, authKind);
  if (machineId !== undefined) headers.set(GATE_MACHINE_ID_HEADER, machineId);
  return new Request(request, { headers });
}

function tunnelStub(env: Env, handle: string): DurableObjectStub {
  return env.TUNNEL_DO.get(env.TUNNEL_DO.idFromName(handle));
}

async function readTunnelStatus(
  env: Env,
  handle: string,
): Promise<TunnelStatus> {
  try {
    const response = await tunnelStub(env, handle).fetch(
      "https://tunnel/__control/status",
    );
    return (await response.json()) as TunnelStatus;
  } catch {
    return { live: false, lastSeenAt: null };
  }
}

function isLive(status: TunnelStatus): boolean {
  return (
    status.live ||
    (status.lastSeenAt !== null &&
      Date.now() - status.lastSeenAt < SERVER_OFFLINE_AFTER_MS)
  );
}

async function closeTunnel(env: Env, handle: string): Promise<void> {
  try {
    await tunnelStub(env, handle).fetch("https://tunnel/__control/close");
  } catch {}
}

async function readJsonBody(
  request: Request,
): Promise<Record<string, unknown>> {
  try {
    const body: unknown = await request.json();
    return typeof body === "object" && body !== null && !Array.isArray(body)
      ? (body as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function cookieHeader(
  value: string,
  expiresAt: number,
  topology: RelayTopology,
): string {
  const domain =
    topology.role === "single" ? "" : `; Domain=${topology.cookieDomain}`;
  return `${SESSION_COOKIE_NAME}=${value}; Path=/${domain}; Secure; HttpOnly; SameSite=Lax; Expires=${new Date(expiresAt).toUTCString()}`;
}

async function presentedCredential(
  request: Request,
  store: RelayStore,
): Promise<Awaited<ReturnType<RelayStore["resolveCredential"]>>> {
  return store.resolveCredential(
    request.headers.get(MACHINE_CREDENTIAL_HEADER) ?? "",
  );
}

async function handleRedeem(
  request: Request,
  topology: RelayTopology,
  env: Env,
  store: RelayStore,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const body = await readJsonBody(request);
  const code = typeof body.code === "string" ? body.code.trim() : "";
  if (
    env.PAIR_CODE.length === 0 ||
    code.length === 0 ||
    !constantTimeEqual(code, env.PAIR_CODE)
  ) {
    return json({ error: "invalid code" }, 400);
  }
  const requestedHandle =
    typeof body.handle === "string" ? body.handle.trim().toLowerCase() : "";
  const handle =
    requestedHandle.length > 0
      ? requestedHandle
      : topology.role === "server" || topology.role === "single"
        ? topology.handle
        : defaultHandle(env);
  if (!isValidHandle(handle)) {
    return json({ error: "invalid handle" }, 400);
  }
  const requestedName = typeof body.name === "string" ? body.name.trim() : "";
  const name = requestedName.length > 0 ? requestedName.slice(0, 80) : handle;
  const credential = randomToken("bbcred_");
  await store.pairServer(handle, name, credential);
  await closeTunnel(env, handle);
  const serverOrigin =
    topology.baseDomain === null
      ? topology.serverOrigin
      : `https://${handle}.${topology.baseDomain}`;
  return json({
    credential,
    handle,
    name,
    serverId: handle,
    serverUrl: serverOrigin,
    tunnelUrl: `${serverOrigin}/__tunnel`,
  });
}

async function handleMachineCode(
  request: Request,
  topology: RelayTopology,
  store: RelayStore,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const subject = await presentedCredential(request, store);
  if (subject?.kind !== "server") return json({ error: "unauthorized" }, 401);
  const code = randomPairingCode();
  await store.createMachineCode(normalizePairingCode(code));
  return json({
    code,
    expiresInMs: MACHINE_CODE_TTL_MS,
    serverUrl: topology.serverOrigin,
  });
}

async function redeemMachine(
  rawCode: string,
  store: RelayStore,
  label: string,
): Promise<{ credential: string; machineId: string } | null> {
  const code = normalizePairingCode(rawCode);
  if (code.length === 0 || !(await store.consumeMachineCode(code))) {
    return null;
  }
  const credential = randomToken("bbcm_");
  const machineId = randomToken("m_", 9);
  await store.addMachine(machineId, credential, label);
  return { credential, machineId };
}

async function handleRedeemMachine(
  request: Request,
  topology: RelayTopology,
  store: RelayStore,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const body = await readJsonBody(request);
  const code = typeof body.code === "string" ? body.code : "";
  const redeemed = await redeemMachine(
    code,
    store,
    request.headers.get("user-agent")?.slice(0, 80) ?? "device",
  );
  if (redeemed === null) return json({ error: "invalid-code" }, 400);
  return json({
    credential: redeemed.credential,
    machineId: redeemed.machineId,
    serverUrl: topology.serverOrigin,
  });
}

async function handleRevokeMachine(
  request: Request,
  store: RelayStore,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const subject = await presentedCredential(request, store);
  if (subject?.kind !== "server") return json({ error: "unauthorized" }, 401);
  const body = await readJsonBody(request);
  const machineId = typeof body.machineId === "string" ? body.machineId : "";
  if (!(await store.removeMachine(machineId))) {
    return json({ error: "not_found" }, 404);
  }
  return json({ ok: true });
}

async function handleDesktopSession(
  request: Request,
  topology: RelayTopology,
  env: Env,
  store: RelayStore,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const subject = await presentedCredential(request, store);
  if (subject === null) return json({ error: "unauthorized" }, 401);
  const expiresAt = Date.now() + API_SESSION_TTL_MS;
  const value = await createSessionCookie(
    subject.kind === "server" ? "server" : `machine:${subject.machineId}`,
    env.SESSION_SECRET,
    expiresAt,
  );
  return json({
    cookie: {
      domain: topology.cookieDomain,
      expiresAt,
      name: SESSION_COOKIE_NAME,
      value,
    },
  });
}

async function handleListServers(
  request: Request,
  topology: RelayTopology,
  env: Env,
  store: RelayStore,
): Promise<Response> {
  if (request.method !== "GET") return methodNotAllowed("GET");
  const subject = await presentedCredential(request, store);
  if (subject === null) return json({ error: "unauthorized" }, 401);
  const servers = await Promise.all(
    (await store.listServerDirectory()).map(async (server) => {
      const status = await readTunnelStatus(env, server.handle);
      return {
        handle: server.handle,
        name: server.name,
        live: isLive(status),
        lastSeenAt: status.lastSeenAt,
        url:
          topology.baseDomain === null
            ? topology.serverOrigin
            : `https://${server.handle}.${topology.baseDomain}`,
      };
    }),
  );
  return json({ servers });
}

async function handleDisconnect(
  request: Request,
  env: Env,
  store: RelayStore,
): Promise<Response> {
  if (request.method !== "POST") return methodNotAllowed("POST");
  const subject = await presentedCredential(request, store);
  if (subject?.kind !== "server") return json({ error: "unauthorized" }, 401);
  await store.unpairServer(subject.handle);
  await closeTunnel(env, subject.handle);
  return json({ ok: true });
}

async function handleBrowserLogin(
  request: Request,
  topology: RelayTopology,
  env: Env,
  store: RelayStore,
): Promise<Response> {
  if (request.method === "GET") return signInPage(null);
  if (request.method !== "POST") return methodNotAllowed("GET, POST");
  const form = await request.formData().catch(() => null);
  const code = form?.get("code");
  const redeemed =
    typeof code === "string"
      ? await redeemMachine(
          code,
          store,
          `browser · ${request.headers.get("user-agent")?.slice(0, 60) ?? ""}`,
        )
      : null;
  if (redeemed === null) {
    return signInPage("That code is not valid or has expired.");
  }
  const expiresAt = Date.now() + BROWSER_SESSION_TTL_MS;
  const value = await createSessionCookie(
    `machine:${redeemed.machineId}`,
    env.SESSION_SECRET,
    expiresAt,
  );
  return new Response(null, {
    status: 303,
    headers: {
      location: "/",
      "set-cookie": cookieHeader(value, expiresAt, topology),
    },
  });
}

async function handleTunnelDial(
  request: Request,
  topology: RelayTopology,
  env: Env,
  store: RelayStore,
): Promise<Response> {
  const auth = request.headers.get("authorization") ?? "";
  const credential = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  const server = await store.getServer(topology.handle);
  if (server === null) return text("Kaioken relay: server not paired\n", 403);
  if ((await sha256Hex(credential)) !== server.credentialHash) {
    return text("Kaioken relay: invalid credential\n", 401);
  }
  const forward = new URL(request.url);
  forward.searchParams.delete("serverId");
  forward.searchParams.delete("machineId");
  forward.searchParams.set("serverId", topology.handle);
  return tunnelStub(env, topology.handle).fetch(new Request(forward, request));
}

function apexPage(
  topology: RelayTopology,
  servers: readonly { handle: string; name: string }[],
): Response {
  const links =
    servers.length === 0
      ? `<a href="${escapeHtml(topology.serverOrigin)}">${escapeHtml(new URL(topology.serverOrigin).host)}</a>`
      : servers
          .map((server) => {
            const origin = `https://${server.handle}.${topology.baseDomain ?? ""}`;
            return `<a href="${escapeHtml(origin)}">${escapeHtml(new URL(origin).host)}</a>`;
          })
          .join(", ");
  return gatePage(
    `<h1>Kaioken</h1>
     <p>This is the relay for a personal Kaioken. Each Mac pairs with its own name:
     ${links}.</p>`,
    200,
  );
}

const PAIRING_PATHS = new Set([
  "/api/connect/redeem",
  "/api/connect/redeem-machine",
  "/__login",
]);

async function pairingAttemptsExhausted(
  request: Request,
  env: Env,
): Promise<boolean> {
  if (request.method !== "POST") return false;
  const key =
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-forwarded-for") ??
    "unknown";
  const stub = env.PAIRING_LIMITER.get(env.PAIRING_LIMITER.idFromName(key));
  const { allowed } = (await (
    await stub.fetch("https://limiter/attempt", { method: "POST" })
  ).json()) as { allowed: boolean };
  return !allowed;
}

function tooManyAttempts(request: Request): Response {
  return wantsHtml(request)
    ? gatePage(
        `<h1>Too many attempts</h1>
     <p>Wait a minute, then try the pairing code again.</p>`,
        429,
      )
    : json({ error: "too_many_attempts" }, 429);
}

async function handleAccountApi(
  request: Request,
  topology: RelayTopology,
  env: Env,
  store: RelayStore,
): Promise<Response | null> {
  switch (new URL(request.url).pathname) {
    case "/api/connect/redeem":
      return handleRedeem(request, topology, env, store);
    case "/api/connect/machine-code":
      return handleMachineCode(request, topology, store);
    case "/api/connect/redeem-machine":
      return handleRedeemMachine(request, topology, store);
    case "/api/connect/revoke-machine":
      return handleRevokeMachine(request, store);
    case "/api/connect/desktop-session":
      return handleDesktopSession(request, topology, env, store);
    case "/api/connect/servers":
      return handleListServers(request, topology, env, store);
    case "/api/connect/disconnect":
      return handleDisconnect(request, env, store);
    default:
      return null;
  }
}

async function routeRequest(
  request: Request,
  url: URL,
  topology: RelayTopology,
  env: Env,
  ctx: ExecutionContext,
  store: RelayStore,
): Promise<Response> {
  if (
    PAIRING_PATHS.has(url.pathname) &&
    (await pairingAttemptsExhausted(request, env))
  ) {
    return tooManyAttempts(request);
  }

  if (url.pathname.startsWith("/api/connect/")) {
    if (!acceptsAccountApi(topology)) {
      return text("Kaioken relay: not found\n", 404);
    }
    const handled = await handleAccountApi(request, topology, env, store);
    if (handled !== null) return handled;
  }
  if (url.pathname === "/__health") {
    return json({
      ok: true,
      role: topology.role,
      handle: topology.handle,
      ...(await readTunnelStatus(env, topology.handle)),
    });
  }
  if (topology.role === "apex") {
    return url.pathname === "/"
      ? apexPage(topology, await store.listServerDirectory())
      : text("Kaioken relay: not found\n", 404);
  }
  if (url.pathname === "/__login" && acceptsVisitors(topology)) {
    return handleBrowserLogin(request, topology, env, store);
  }
  if (url.pathname === "/__tunnel") {
    if (!acceptsTunnel(topology)) {
      return text("Kaioken relay: not found\n", 404);
    }
    return handleTunnelDial(request, topology, env, store);
  }
  if (url.pathname.startsWith("/__") || !acceptsVisitors(topology)) {
    return text("Kaioken relay: not found\n", 404);
  }

  const stub = tunnelStub(env, topology.handle);
  if (
    request.method === "GET" &&
    topology.target === null &&
    PUBLIC_INSTALL_PATHS.has(url.pathname)
  ) {
    return stub.fetch(requestForTunnelDo(request, null));
  }

  const presentedCredential = request.headers.get(MACHINE_CREDENTIAL_HEADER);
  if (isMachinePath(url.pathname) && presentedCredential !== null) {
    if (topology.target !== null) {
      return text("Kaioken relay: not found\n", 404);
    }
    const subject = await store.resolveCredential(presentedCredential);
    if (subject === null) {
      return text("Kaioken relay: machine not authorized\n", 403);
    }
    if (
      subject.kind === "machine" &&
      isHostManagementMutation(request, url.pathname)
    ) {
      return text("Kaioken relay: machine cannot manage hosts\n", 403);
    }
    return stub.fetch(
      requestForTunnelDo(
        request,
        null,
        subject.kind === "machine" ? subject.machineId : undefined,
        "machine",
      ),
    );
  }
  if (url.pathname.startsWith("/internal")) {
    return text("Kaioken relay: machine not authorized\n", 403);
  }

  const cookie = parseCookie(
    request.headers.get("cookie"),
    SESSION_COOKIE_NAME,
  );
  const subject = cookie
    ? await verifySessionCookie(cookie, env.SESSION_SECRET)
    : null;
  if (subject === null) {
    return wantsHtml(request)
      ? signInPage(null)
      : json({ error: "unauthorized" }, 401);
  }
  if (subject !== "server") {
    const machineId = subject.slice("machine:".length);
    if (!(await store.machineExists(machineId))) {
      return wantsHtml(request)
        ? signInPage("This device was removed. Pair it again.")
        : json({ error: "unauthorized" }, 401);
    }
  }

  const doRequest = requestForTunnelDo(
    request,
    topology.target,
    subject === "server" ? undefined : subject.slice("machine:".length),
  );
  if (request.headers.get("upgrade")?.toLowerCase() === "websocket") {
    if (!isTrustedUpgradeOrigin(request.headers.get("origin"), topology)) {
      return text("Kaioken relay: origin not allowed\n", 403);
    }
    return stub.fetch(doRequest);
  }
  const cacheNamespace =
    topology.target === null
      ? topology.handle
      : `${topology.handle}--${topology.target}`;
  const cached = await serveWithCache(request, cacheNamespace, ctx, (init) => {
    if (init === undefined) return stub.fetch(doRequest);
    const headers = new Headers(doRequest.headers);
    headers.set("if-none-match", init.ifNoneMatch);
    return stub.fetch(new Request(doRequest, { headers }));
  });
  const response = cached.response;
  if (
    response.status === 503 &&
    response.headers.get(TUNNEL_OFFLINE_HEADER) === "1" &&
    wantsHtml(request)
  ) {
    return offlinePage(
      (await readTunnelStatus(env, topology.handle)).lastSeenAt,
    );
  }
  return response;
}

export default {
  async fetch(
    request: Request,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url);
    const topology = resolveTopology(url, env);
    if (topology.role === "unknown") {
      return text("Kaioken relay: unknown host\n", 404);
    }
    const cors =
      topology.role === "apex" ? null : corsHeadersFor(request, topology);
    if (request.method === "OPTIONS" && cors !== null) {
      return new Response(null, { status: 204, headers: cors });
    }
    const store = new RelayStore(env.STATE, defaultHandle(env));
    return withCors(
      await routeRequest(request, url, topology, env, ctx, store),
      cors,
    );
  },
} satisfies ExportedHandler<Env>;
