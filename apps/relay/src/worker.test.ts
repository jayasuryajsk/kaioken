import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { Miniflare, createFetchMock } from "miniflare";
import {
  connectLoginStartSchema,
  connectLoginDeviceSchema,
} from "@kaioken/connect-client";
import NodeWebSocket from "ws";
import { build } from "esbuild";
import { join } from "node:path";
import { createSessionCookie, sha256Hex, verifySessionCookie } from "./auth";
import { relativeTime } from "./worker";

const PAIR_CODE = "pair-me-please";
const SESSION_SECRET = "test-session-secret";
const ORIGIN = "https://kaioken.example.workers.dev";

let mf: Miniflare;
let domainMf: Miniflare;
let bundleText: string;

type DispatchInit = Parameters<Miniflare["dispatchFetch"]>[1];
type DispatchResponse = Awaited<ReturnType<Miniflare["dispatchFetch"]>>;

function createRelay(
  bindings: Record<string, string>,
  fetchMock?: ReturnType<typeof createFetchMock>,
): Miniflare {
  return new Miniflare({
    modules: [{ type: "ESModule", path: "/worker.mjs", contents: bundleText }],
    modulesRoot: "/",
    scriptPath: "/worker.mjs",
    compatibilityDate: "2026-06-11",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      TUNNEL_DO: "TunnelDO",
      PAIRING_LIMITER: "PairingLimiter",
      ACCOUNT_DO: "AccountDO",
      LOGIN_DO: "LoginDO",
    },
    kvNamespaces: ["STATE"],
    ...(fetchMock ? { fetchMock } : {}),
    bindings: { PAIR_CODE, SESSION_SECRET, ...bindings },
  });
}

beforeAll(async () => {
  const bundle = await build({
    entryPoints: [join(import.meta.dirname, "worker.ts")],
    bundle: true,
    format: "esm",
    platform: "browser",
    target: "es2022",
    write: false,
    conditions: ["workerd", "worker", "browser", "source"],
  });
  bundleText = bundle.outputFiles[0]!.text;
  mf = createRelay({});
  domainMf = createRelay({ BASE_DOMAIN: "kaioken.app", HANDLE: "studio" });
  await Promise.all([mf.ready, domainMf.ready]);
});

afterAll(async () => {
  await Promise.all([mf?.dispose(), domainMf?.dispose()]);
});

let testAddress = 0;

beforeEach(() => {
  testAddress += 1;
});

function withTestAddress(init?: DispatchInit): DispatchInit {
  const headers: Record<string, string> = {
    "cf-connecting-ip": `10.1.${testAddress}.1`,
  };
  const given = init?.headers;
  if (given !== undefined) {
    for (const [name, value] of Object.entries(
      given as Record<string, string>,
    )) {
      headers[name] = value;
    }
  }
  return { ...init, headers };
}

function request(path: string, init?: DispatchInit): Promise<DispatchResponse> {
  return mf.dispatchFetch(`${ORIGIN}${path}`, withTestAddress(init));
}

async function pairServer(): Promise<string> {
  const response = await request("/api/connect/redeem", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: PAIR_CODE }),
  });
  expect(response.status).toBe(200);
  const body = (await response.json()) as {
    credential: string;
    handle: string;
  };
  expect(body.handle).toBe("kaioken");
  return body.credential;
}

describe("Kaioken relay", () => {
  it("refuses a wrong pairing code and accepts the configured one", async () => {
    const wrong = await request("/api/connect/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: "nope" }),
    });
    expect(wrong.status).toBe(400);
    const credential = await pairServer();
    expect(credential.startsWith("bbcred_")).toBe(true);
  });

  it("only lets the paired server dial the tunnel", async () => {
    const credential = await pairServer();
    const bad = await request("/__tunnel?v=1", {
      headers: { authorization: "Bearer bbcred_wrong", upgrade: "websocket" },
    });
    expect(bad.status).toBe(401);
    const good = await request("/__tunnel?v=1", {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(good.status).toBe(426);
  });

  it("issues phone pairing codes, redeems them once, and mints sessions", async () => {
    const credential = await pairServer();
    const unauthorized = await request("/api/connect/machine-code", {
      method: "POST",
    });
    expect(unauthorized.status).toBe(401);

    const issued = await request("/api/connect/machine-code", {
      method: "POST",
      headers: { "x-bb-connect-machine": credential },
    });
    expect(issued.status).toBe(200);
    const { code, serverUrl } = (await issued.json()) as {
      code: string;
      serverUrl: string;
    };
    expect(code).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(serverUrl).toBe(ORIGIN);

    const redeemed = await request("/api/connect/redeem-machine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: code.toLowerCase() }),
    });
    expect(redeemed.status).toBe(200);
    const machine = (await redeemed.json()) as {
      credential: string;
      machineId: string;
      serverUrl: string;
    };
    expect(machine.credential.startsWith("bbcm_")).toBe(true);
    expect(machine.serverUrl).toBe(ORIGIN);

    const again = await request("/api/connect/redeem-machine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(again.status).toBe(400);

    const session = await request("/api/connect/desktop-session", {
      method: "POST",
      headers: { "x-bb-connect-machine": machine.credential },
    });
    expect(session.status).toBe(200);
    const { cookie } = (await session.json()) as {
      cookie: { domain: string; name: string; value: string };
    };
    expect(cookie.domain).toBe("kaioken.example.workers.dev");
    expect(await verifySessionCookie(cookie.value, SESSION_SECRET)).toBe(
      `machine:${machine.machineId}`,
    );

    const servers = await request("/api/connect/servers", {
      headers: { "x-bb-connect-machine": machine.credential },
    });
    expect(await servers.json()).toMatchObject({
      servers: [{ handle: "kaioken", name: "kaioken", live: false }],
    });

    const revoked = await request("/api/connect/revoke-machine", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bb-connect-machine": credential,
      },
      body: JSON.stringify({ machineId: machine.machineId }),
    });
    expect(await revoked.json()).toEqual({ ok: true });
    const afterRevoke = await request("/api/connect/desktop-session", {
      method: "POST",
      headers: { "x-bb-connect-machine": machine.credential },
    });
    expect(afterRevoke.status).toBe(401);
  });

  it("gates visitors behind the session cookie and explains offline servers", async () => {
    await pairServer();
    const anonymous = await request("/", { headers: { accept: "text/html" } });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.text()).toContain("Enter a pairing code");
    const anonymousApi = await request("/api/v1/threads");
    expect(anonymousApi.status).toBe(401);

    const value = await createSessionCookie(
      "server",
      SESSION_SECRET,
      Date.now() + 60_000,
    );
    const offline = await request("/", {
      headers: {
        accept: "text/html",
        cookie: `__Secure-kaioken-connect.desktop_session=${value}`,
      },
    });
    expect(offline.status).toBe(503);
    expect(await offline.text()).toContain("Your Kaioken is offline");

    const forged = await createSessionCookie(
      "server",
      "another-secret",
      Date.now() + 60_000,
    );
    const rejected = await request("/", {
      headers: { cookie: `__Secure-kaioken-connect.desktop_session=${forged}` },
    });
    expect(rejected.status).toBe(401);
  });

  it("lets a browser sign in with a phone pairing code", async () => {
    const credential = await pairServer();
    const issued = await request("/api/connect/machine-code", {
      method: "POST",
      headers: { "x-bb-connect-machine": credential },
    });
    const { code } = (await issued.json()) as { code: string };
    const login = await request("/__login", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code }).toString(),
      redirect: "manual",
    });
    expect(login.status).toBe(303);
    const setCookie = login.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("__Secure-kaioken-connect.desktop_session=");
    const value = setCookie.split(";")[0]!.split("=").slice(1).join("=");
    expect(
      (await verifySessionCookie(value, SESSION_SECRET))?.startsWith(
        "machine:",
      ),
    ).toBe(true);
  });

  it("lets enrolled machines reach the daemon API and serves the installer publicly", async () => {
    const credential = await pairServer();
    const installer = await request("/install.sh");
    expect(installer.status).toBe(503);
    const anonymous = await request("/internal/hosts/enroll", {
      method: "POST",
    });
    expect(anonymous.status).toBe(403);
    const bogus = await request("/internal/hosts/enroll", {
      method: "POST",
      headers: { "x-bb-connect-machine": "not-a-credential" },
    });
    expect(bogus.status).toBe(403);
    const asServer = await request("/internal/hosts/enroll", {
      method: "POST",
      headers: { "x-bb-connect-machine": credential },
    });
    expect(asServer.status).toBe(503);

    const issued = await request("/api/connect/machine-code", {
      method: "POST",
      headers: { "x-bb-connect-machine": credential },
    });
    const { code } = (await issued.json()) as { code: string };
    const redeemed = await request("/api/connect/redeem-machine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code, label: "mini" }),
    });
    const machine = (await redeemed.json()) as { credential: string };
    const asMachine = await request("/api/v1/threads", {
      headers: { "x-bb-connect-machine": machine.credential },
    });
    expect(asMachine.status).toBe(503);
    const forbidden = await request("/api/v1/hosts/join-codes", {
      method: "POST",
      headers: { "x-bb-connect-machine": machine.credential },
    });
    expect(forbidden.status).toBe(403);
  });

  it("refuses cookie-authenticated websocket upgrades from foreign origins", async () => {
    await pairServer();
    const value = await createSessionCookie(
      "server",
      SESSION_SECRET,
      Date.now() + 60_000,
    );
    const cookie = `__Secure-kaioken-connect.desktop_session=${value}`;
    const upgrade = (origin: string | null) =>
      request("/api/v1/events", {
        headers: {
          cookie,
          upgrade: "websocket",
          connection: "Upgrade",
          ...(origin === null ? {} : { origin }),
        },
      });
    expect((await upgrade("https://evil.example")).status).toBe(403);
    expect((await upgrade("http://127.0.0.1:38886")).status).not.toBe(403);
    expect((await upgrade(null)).status).not.toBe(403);
  });

  it("disconnect unpairs the server", async () => {
    const credential = await pairServer();
    const response = await request("/api/connect/disconnect", {
      method: "POST",
      headers: { "x-bb-connect-machine": credential },
    });
    expect(await response.json()).toEqual({ ok: true });
    const dial = await request("/__tunnel?v=1", {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(dial.status).toBe(403);
  });
});

describe("Kaioken relay in domain mode", () => {
  const apex = (path: string, init?: DispatchInit) =>
    domainMf.dispatchFetch(`https://kaioken.app${path}`, withTestAddress(init));
  const studio = (path: string, init?: DispatchInit) =>
    domainMf.dispatchFetch(
      `https://studio.kaioken.app${path}`,
      withTestAddress(init),
    );

  it("serves pairing on the apex and the app on the handle host", async () => {
    const reservedHost = await domainMf.dispatchFetch(
      "https://www.kaioken.app/",
    );
    expect(reservedHost.status).toBe(404);
    const otherHandle = await domainMf.dispatchFetch(
      "https://other.kaioken.app/",
    );
    expect(otherHandle.status).toBe(401);

    const paired = await apex("/api/connect/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: PAIR_CODE }),
    });
    expect(paired.status).toBe(200);
    const { credential, handle, tunnelUrl } = (await paired.json()) as {
      credential: string;
      handle: string;
      tunnelUrl: string;
    };
    expect(handle).toBe("studio");
    expect(tunnelUrl).toBe("https://studio.kaioken.app/__tunnel");

    const onStudio = await studio("/api/connect/desktop-session", {
      method: "POST",
      headers: { "x-bb-connect-machine": credential },
    });
    expect(onStudio.status).toBe(200);
    const issued = await apex("/api/connect/machine-code", {
      method: "POST",
      headers: { "x-bb-connect-machine": credential },
    });
    expect(((await issued.json()) as { serverUrl: string }).serverUrl).toBe(
      "https://studio.kaioken.app",
    );

    const session = await apex("/api/connect/desktop-session", {
      method: "POST",
      headers: { "x-bb-connect-machine": credential },
    });
    const { cookie } = (await session.json()) as {
      cookie: { domain: string };
    };
    expect(cookie.domain).toBe(".kaioken.app");

    const apexDial = await apex("/__tunnel?v=1", {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(apexDial.status).toBe(404);
    const studioDial = await studio("/__tunnel?v=1", {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(studioDial.status).toBe(426);

    const landing = await apex("/", { headers: { accept: "text/html" } });
    expect(landing.status).toBe(200);
    expect(await landing.text()).toContain("studio.kaioken.app");
    const gated = await studio("/", { headers: { accept: "text/html" } });
    expect(gated.status).toBe(401);
  });

  it("scopes browser login cookies to the whole domain and routes shares by port", async () => {
    await apex("/api/connect/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: PAIR_CODE }),
    });
    const value = await createSessionCookie(
      "server",
      SESSION_SECRET,
      Date.now() + 60_000,
    );
    const share = await domainMf.dispatchFetch(
      "https://studio--3000.kaioken.app/",
      {
        headers: {
          accept: "text/html",
          cookie: `__Secure-kaioken-connect.desktop_session=${value}`,
        },
      },
    );
    expect(share.status).toBe(503);
  });
});

describe("Kaioken relay with many servers", () => {
  const apex = (path: string, init?: DispatchInit) =>
    domainMf.dispatchFetch(`https://kaioken.app${path}`, withTestAddress(init));
  const host = (handle: string, path: string, init?: DispatchInit) =>
    domainMf.dispatchFetch(
      `https://${handle}.kaioken.app${path}`,
      withTestAddress(init),
    );
  const pairHandle = async (handle: string, name?: string) => {
    const response = await apex("/api/connect/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: PAIR_CODE, handle, name }),
    });
    expect(response.status).toBe(200);
    return (await response.json()) as {
      credential: string;
      handle: string;
      serverUrl: string;
      tunnelUrl: string;
    };
  };

  it("pairs several handles that each dial only their own tunnel", async () => {
    const mini = await pairHandle("mini", "Mac mini");
    const studio = await pairHandle("studio");
    expect(mini.serverUrl).toBe("https://mini.kaioken.app");
    expect(mini.tunnelUrl).toBe("https://mini.kaioken.app/__tunnel");
    expect(studio.serverUrl).toBe("https://studio.kaioken.app");

    const ownDial = await host("mini", "/__tunnel?v=1", {
      headers: { authorization: `Bearer ${mini.credential}` },
    });
    expect(ownDial.status).toBe(426);
    const crossDial = await host("studio", "/__tunnel?v=1", {
      headers: { authorization: `Bearer ${mini.credential}` },
    });
    expect(crossDial.status).toBe(401);
    const unpaired = await host("laptop", "/__tunnel?v=1", {
      headers: { authorization: `Bearer ${mini.credential}` },
    });
    expect(unpaired.status).toBe(403);

    const invalid = await apex("/api/connect/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: PAIR_CODE, handle: "Not_Valid" }),
    });
    expect(invalid.status).toBe(400);
    const reserved = await apex("/api/connect/redeem", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code: PAIR_CODE, handle: "www" }),
    });
    expect(reserved.status).toBe(400);
  });

  it("lists every paired server with its own liveness for any account credential", async () => {
    const mini = await pairHandle("mini", "Mac mini");
    const studio = await pairHandle("studio", "MacBook");
    const listed = await apex("/api/connect/servers", {
      headers: { "x-bb-connect-machine": mini.credential },
    });
    expect(listed.status).toBe(200);
    const body = (await listed.json()) as {
      servers: { handle: string; name: string; live: boolean; url: string }[];
    };
    expect(
      body.servers.map((s) => [s.handle, s.name, s.live, s.url]).sort(),
    ).toEqual([
      ["mini", "Mac mini", false, "https://mini.kaioken.app"],
      ["studio", "MacBook", false, "https://studio.kaioken.app"],
    ]);

    const issued = await apex("/api/connect/machine-code", {
      method: "POST",
      headers: { "x-bb-connect-machine": studio.credential },
    });
    const { code } = (await issued.json()) as { code: string };
    const redeemed = await apex("/api/connect/redeem-machine", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const machine = (await redeemed.json()) as { credential: string };
    const onMini = await host("mini", "/api/v1/threads", {
      headers: { "x-bb-connect-machine": machine.credential },
    });
    expect(onMini.status).toBe(503);
    const onStudio = await host("studio", "/api/v1/threads", {
      headers: { "x-bb-connect-machine": machine.credential },
    });
    expect(onStudio.status).toBe(503);
    const value = await createSessionCookie(
      "server",
      SESSION_SECRET,
      Date.now() + 60_000,
    );
    const cookieOnMini = await host("mini", "/", {
      headers: {
        accept: "text/html",
        cookie: `__Secure-kaioken-connect.desktop_session=${value}`,
      },
    });
    expect(cookieOnMini.status).toBe(503);
    const health = (await (await host("mini", "/__health")).json()) as {
      handle: string;
      live: boolean;
    };
    expect(health.handle).toBe("mini");
    expect(health.live).toBe(false);
  });

  it("answers CORS for sibling handles and refuses foreign origins", async () => {
    await pairHandle("mini");
    const preflight = await host("mini", "/api/v1/threads", {
      method: "OPTIONS",
      headers: {
        origin: "https://studio.kaioken.app",
        "access-control-request-method": "POST",
        "access-control-request-headers": "content-type, x-custom",
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get("access-control-allow-origin")).toBe(
      "https://studio.kaioken.app",
    );
    expect(preflight.headers.get("access-control-allow-credentials")).toBe(
      "true",
    );
    expect(preflight.headers.get("access-control-allow-methods")).toContain(
      "DELETE",
    );
    expect(preflight.headers.get("access-control-allow-headers")).toContain(
      "x-custom",
    );
    expect(preflight.headers.get("vary")).toBe("Origin");

    const actual = await host("mini", "/api/v1/threads", {
      headers: { origin: "https://kaioken.app" },
    });
    expect(actual.status).toBe(401);
    expect(actual.headers.get("access-control-allow-origin")).toBe(
      "https://kaioken.app",
    );

    const foreign = await host("mini", "/api/v1/threads", {
      method: "OPTIONS",
      headers: {
        origin: "https://evil.example",
        "access-control-request-method": "GET",
      },
    });
    expect(foreign.headers.get("access-control-allow-origin")).toBeNull();
    const insecure = await host("mini", "/api/v1/threads", {
      headers: { origin: "http://studio.kaioken.app" },
    });
    expect(insecure.headers.get("access-control-allow-origin")).toBeNull();
  });

  it("migrates the legacy single-server record and keeps its credential dialling", async () => {
    const legacyMf = createRelay({
      BASE_DOMAIN: "kaioken.app",
      HANDLE: "studio",
    });
    const kv = await legacyMf.getKVNamespace("STATE");
    const credential = "bbcred_legacy_secret";
    const hash = await sha256Hex(credential);
    await kv.put(
      "server",
      JSON.stringify({
        credentialHash: hash,
        handle: "legacyhost",
        pairedAt: 5,
      }),
    );
    await kv.put(`token:${hash}`, JSON.stringify({ kind: "server" }));

    const dial = await legacyMf.dispatchFetch(
      "https://legacyhost.kaioken.app/__tunnel?v=1",
      {
        headers: { authorization: `Bearer ${credential}` },
      },
    );
    expect(dial.status).toBe(426);
    const listed = await legacyMf.dispatchFetch(
      "https://kaioken.app/api/connect/servers",
      {
        headers: { "x-bb-connect-machine": credential },
      },
    );
    expect(
      ((await listed.json()) as { servers: { handle: string }[] }).servers.map(
        (s) => s.handle,
      ),
    ).toContain("legacyhost");
    await legacyMf.dispose();
  });

  it("disconnect unpairs only the calling handle", async () => {
    const mini = await pairHandle("mini");
    const studio = await pairHandle("studio");
    const response = await apex("/api/connect/disconnect", {
      method: "POST",
      headers: { "x-bb-connect-machine": mini.credential },
    });
    expect(await response.json()).toEqual({ ok: true });
    const miniDial = await host("mini", "/__tunnel?v=1", {
      headers: { authorization: `Bearer ${mini.credential}` },
    });
    expect(miniDial.status).toBe(403);
    const studioDial = await host("studio", "/__tunnel?v=1", {
      headers: { authorization: `Bearer ${studio.credential}` },
    });
    expect(studioDial.status).toBe(426);
  });
});

describe("live account discovery", () => {
  async function pair(relay: Miniflare, handle: string) {
    const response = await relay.dispatchFetch(
      "https://kaioken.app/api/connect/redeem",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: PAIR_CODE, handle }),
      },
    );
    expect(response.status).toBe(200);
    return (await response.json()) as { credential: string };
  }

  function collectSnapshots(
    socket: NonNullable<DispatchResponse["webSocket"]>,
  ) {
    const snapshots: { servers: { handle: string; live: boolean }[] }[] = [];
    socket.addEventListener("message", (event) => {
      if (typeof event.data !== "string" || event.data === "kaioken:pong")
        return;
      snapshots.push(JSON.parse(event.data));
    });
    socket.accept();
    return snapshots;
  }

  it("pushes new devices and tunnel presence immediately, then resynchronizes on reconnect", async () => {
    const relay = createRelay({ BASE_DOMAIN: "kaioken.app", HANDLE: "studio" });
    try {
      const studio = await pair(relay, "studio");
      const subscribe = () =>
        relay.dispatchFetch("https://studio.kaioken.app/api/connect/events", {
          headers: {
            upgrade: "websocket",
            "x-bb-connect-machine": studio.credential,
          },
        });
      const response = await subscribe();
      expect(response.status).toBe(101);
      const socket = response.webSocket!;
      const snapshots = collectSnapshots(socket);
      await vi.waitFor(() =>
        expect(snapshots.at(-1)?.servers).toEqual([
          expect.objectContaining({ handle: "studio" }),
        ]),
      );
      const book = await pair(relay, "book");
      await vi.waitFor(() =>
        expect(snapshots.at(-1)?.servers).toContainEqual(
          expect.objectContaining({ handle: "book", live: false }),
        ),
      );
      const tunnel = await relay.dispatchFetch(
        "https://book.kaioken.app/__tunnel?v=1",
        {
          headers: {
            upgrade: "websocket",
            authorization: `Bearer ${book.credential}`,
          },
        },
      );
      expect(tunnel.status).toBe(101);
      tunnel.webSocket!.accept();
      await vi.waitFor(() =>
        expect(snapshots.at(-1)?.servers).toContainEqual(
          expect.objectContaining({ handle: "book", live: true }),
        ),
      );
      tunnel.webSocket!.close(1000);
      await vi.waitFor(() =>
        expect(snapshots.at(-1)?.servers).toContainEqual(
          expect.objectContaining({ handle: "book", live: false }),
        ),
      );
      socket.close(1000);
      await pair(relay, "mini");
      const reconnected = await subscribe();
      const fresh = collectSnapshots(reconnected.webSocket!);
      await vi.waitFor(() =>
        expect(fresh.at(-1)?.servers.map((server) => server.handle)).toContain(
          "mini",
        ),
      );
      reconnected.webSocket!.close(1000);
    } finally {
      await relay.dispose();
    }
  });

  it("notifies revoked subscriptions and immediately refuses their credentials", async () => {
    const relay = createRelay({ BASE_DOMAIN: "kaioken.app", HANDLE: "studio" });
    let socket: NodeWebSocket | null = null;
    try {
      const studio = await pair(relay, "studio");
      const headers = { "x-bb-connect-machine": studio.credential };
      const issued = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/machine-code",
        { method: "POST", headers },
      );
      const { code } = (await issued.json()) as { code: string };
      const redeemed = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/redeem-machine",
        { method: "POST", body: JSON.stringify({ code }) },
      );
      const machine = (await redeemed.json()) as {
        credential: string;
        machineId: string;
      };
      const socketUrl = new URL("/api/connect/events", await relay.ready);
      socketUrl.protocol = "ws:";
      const subscription = new NodeWebSocket(socketUrl, {
        headers: {
          host: "kaioken.app",
          "x-bb-connect-machine": machine.credential,
        },
      });
      socket = subscription;
      const revoked = new Promise<void>((resolve) =>
        subscription.on("message", (data) => {
          if (data.toString() === JSON.stringify({ type: "revoked" }))
            resolve();
        }),
      );
      await new Promise<void>((resolve, reject) => {
        subscription.once("open", resolve);
        subscription.once("error", reject);
      });
      const revoke = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/revoke-machine",
        {
          method: "POST",
          headers,
          body: JSON.stringify({ machineId: machine.machineId }),
        },
      );
      expect(revoke.status).toBe(200);
      await revoked;
      const refused = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/events",
        {
          headers: {
            upgrade: "websocket",
            "x-bb-connect-machine": machine.credential,
          },
        },
      );
      expect(refused.status).toBe(401);
    } finally {
      socket?.terminate();
      await relay.dispose();
    }
  });

  it("consumes pairing codes atomically and uses durable account state after importing KV", async () => {
    const relay = createRelay({ BASE_DOMAIN: "kaioken.app", HANDLE: "studio" });
    try {
      const studio = await pair(relay, "studio");
      const headers = { "x-bb-connect-machine": studio.credential };
      const issued = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/machine-code",
        { method: "POST", headers },
      );
      const { code } = (await issued.json()) as { code: string };
      const redeemed = await Promise.all(
        [1, 2].map(() =>
          relay.dispatchFetch(
            "https://kaioken.app/api/connect/redeem-machine",
            { method: "POST", body: JSON.stringify({ code }) },
          ),
        ),
      );
      expect(redeemed.map((result) => result.status).sort()).toEqual([
        200, 400,
      ]);
      const kv = await relay.getKVNamespace("STATE");
      expect((await kv.list()).keys).toHaveLength(0);
      const listed = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/servers",
        { headers },
      );
      expect(listed.status).toBe(200);
      expect(
        ((await listed.json()) as { servers: unknown[] }).servers,
      ).toHaveLength(1);
    } finally {
      await relay.dispose();
    }
  });
});

describe("pairing rate limit", () => {
  it("blocks the seventh bad attempt from one address within a minute", async () => {
    const limited = createRelay({});
    await limited.ready;
    try {
      const statuses: number[] = [];
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const response = await limited.dispatchFetch(
          `${ORIGIN}/api/connect/redeem-machine`,
          {
            method: "POST",
            headers: {
              "content-type": "application/json",
              "cf-connecting-ip": "203.0.113.9",
            },
            body: JSON.stringify({ code: "WRONG-CODE" }),
          },
        );
        statuses.push(response.status);
      }
      expect(statuses).toEqual([400, 400, 400, 400, 400, 400, 429, 429]);
      const otherAddress = await limited.dispatchFetch(
        `${ORIGIN}/api/connect/redeem-machine`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "cf-connecting-ip": "203.0.113.10",
          },
          body: JSON.stringify({ code: "WRONG-CODE" }),
        },
      );
      expect(otherAddress.status).toBe(400);
    } finally {
      await limited.dispose();
    }
  });
});

describe("relativeTime", () => {
  it("humanises recent timestamps", () => {
    const now = 1_000_000_000;
    expect(relativeTime(now - 10_000, now)).toBe("just now");
    expect(relativeTime(now - 3 * 60_000, now)).toBe("3 minutes ago");
    expect(relativeTime(now - 2 * 3_600_000, now)).toBe("2 hours ago");
  });
});

describe("GitHub account sign-in", () => {
  function fixture(githubId = 42) {
    const outbound = createFetchMock();
    outbound.disableNetConnect();
    outbound
      .get("https://github.com")
      .intercept({ path: "/login/oauth/access_token", method: "POST" })
      .reply(200, { access_token: "github-test-token", token_type: "bearer" })
      .persist();
    outbound
      .get("https://api.github.com")
      .intercept({
        path: "/user",
        method: "GET",
        headers: { authorization: "Bearer github-test-token" },
      })
      .reply(200, { id: githubId, login: "owner" })
      .persist();
    return createRelay(
      {
        BASE_DOMAIN: "kaioken.app",
        GITHUB_CLIENT_ID: "test-client",
        GITHUB_CLIENT_SECRET: "test-secret",
        GITHUB_ALLOWED_USER_ID: "42",
      },
      outbound,
    );
  }
  async function begin(
    relay: Miniflare,
    proof: string,
    previous: { handle: string; hash: string } | null = null,
  ) {
    const response = await relay.dispatchFetch(
      "https://kaioken.app/api/connect/login",
      {
        method: "POST",
        body: JSON.stringify({
          name: "My Mac",
          challenge: await sha256Hex(proof),
          previous,
        }),
      },
    );
    expect(response.status).toBe(200);
    const login = connectLoginStartSchema.parse(await response.json());
    const browser = await relay.dispatchFetch(login.browserUrl);
    const cookie = browser.headers.get("set-cookie")!.split(";")[0]!;
    const html = await browser.text();
    expect(html).toContain("Connect My Mac");
    expect(html).not.toContain(proof);
    const csrf = /name="csrf" value="([^"]+)"/u.exec(html)![1]!;
    const authorize = await relay.dispatchFetch(login.browserUrl, {
      method: "POST",
      headers: { cookie, "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ csrf }).toString(),
      redirect: "manual",
    });
    expect(authorize.status).toBe(302);
    const github = new URL(authorize.headers.get("location")!);
    expect(github.origin).toBe("https://github.com");
    expect(github.searchParams.get("code_challenge_method")).toBe("S256");
    expect(github.searchParams.get("scope")).toBeNull();
    const callback = new URL("https://kaioken.app/auth/github/callback");
    callback.search = new URLSearchParams({
      state: github.searchParams.get("state")!,
      code: "github-code",
    }).toString();
    return { ...login, cookie, callback: callback.href };
  }
  async function complete(relay: Miniflare, id: string, proof: string) {
    return relay.dispatchFetch(
      `https://kaioken.app/api/connect/login/${id}/complete`,
      {
        method: "POST",
        headers: { "x-kaioken-login-proof": proof },
        body: "null",
      },
    );
  }
  const proofA = `bbcred_${"a".repeat(43)}`;
  const proofB = `bbcred_${"b".repeat(43)}`;

  it("registers two computers without pairing codes, preserves retries, and supports rename/revocation", async () => {
    const relay = fixture();
    try {
      const first = await begin(relay, proofA);
      expect((await complete(relay, first.id, proofA)).status).toBe(409);
      expect(
        (
          await relay.dispatchFetch(first.callback, {
            headers: { cookie: first.cookie },
          })
        ).status,
      ).toBe(200);
      const device = connectLoginDeviceSchema.parse(
        await (await complete(relay, first.id, proofA)).json(),
      );
      expect(device.account).toEqual({ githubId: "42", login: "owner" });
      expect(await (await complete(relay, first.id, proofA)).json()).toEqual(
        device,
      );
      expect((await complete(relay, first.id, proofB)).status).toBe(401);
      expect(
        (
          await relay.dispatchFetch(first.callback, {
            headers: { cookie: first.cookie },
          })
        ).status,
      ).toBe(403);
      const second = await begin(relay, proofB);
      await relay.dispatchFetch(second.callback, {
        headers: { cookie: second.cookie },
      });
      const other = connectLoginDeviceSchema.parse(
        await (await complete(relay, second.id, proofB)).json(),
      );
      expect(other.handle).not.toBe(device.handle);
      const headers = { "x-bb-connect-machine": proofA };
      const list = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/servers",
        { headers },
      );
      expect(
        ((await list.json()) as { servers: unknown[] }).servers,
      ).toHaveLength(2);
      const renamed = await relay.dispatchFetch(
        `https://kaioken.app/api/connect/devices/${other.handle}`,
        { method: "PATCH", headers, body: JSON.stringify({ name: "MacBook" }) },
      );
      expect(renamed.status).toBe(200);
      expect(
        await (
          await relay.dispatchFetch("https://kaioken.app/api/connect/servers", {
            headers,
          })
        ).json(),
      ).toMatchObject({
        servers: expect.arrayContaining([
          expect.objectContaining({ name: "MacBook" }),
        ]),
      });
      expect(
        (
          await relay.dispatchFetch(
            `https://kaioken.app/api/connect/devices/${other.handle}`,
            { method: "DELETE", headers },
          )
        ).status,
      ).toBe(200);
      expect(
        (
          await relay.dispatchFetch("https://kaioken.app/api/connect/servers", {
            headers: { "x-bb-connect-machine": proofB },
          })
        ).status,
      ).toBe(401);
      expect((await complete(relay, second.id, proofB)).status).toBe(410);
    } finally {
      await relay.dispose();
    }
  });

  it("rotates an existing computer without duplicating it and cancels a completed registration", async () => {
    const relay = fixture();
    try {
      const first = await begin(relay, proofA);
      await relay.dispatchFetch(first.callback, {
        headers: { cookie: first.cookie },
      });
      const device = connectLoginDeviceSchema.parse(
        await (await complete(relay, first.id, proofA)).json(),
      );
      const second = await begin(relay, proofB, {
        handle: device.handle,
        hash: await sha256Hex(proofA),
      });
      const events = await relay.dispatchFetch(
        `https://kaioken.app/api/connect/login/${second.id}/events`,
        { headers: { upgrade: "websocket", "x-kaioken-login-proof": proofB } },
      );
      expect(events.status).toBe(101);
      const socket = events.webSocket!;
      socket.accept();
      const approved = new Promise<void>((resolve) =>
        socket.addEventListener("message", (event) => {
          if (JSON.parse(String(event.data)).phase === "approved") resolve();
        }),
      );
      await relay.dispatchFetch(second.callback, {
        headers: { cookie: second.cookie },
      });
      await approved;
      const rotated = connectLoginDeviceSchema.parse(
        await (await complete(relay, second.id, proofB)).json(),
      );
      expect(rotated.handle).toBe(device.handle);
      expect(
        (
          await relay.dispatchFetch("https://kaioken.app/api/connect/servers", {
            headers: { "x-bb-connect-machine": proofA },
          })
        ).status,
      ).toBe(401);
      const directory = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/servers",
        { headers: { "x-bb-connect-machine": proofB } },
      );
      expect(await directory.json()).toMatchObject({
        servers: [expect.objectContaining({ handle: device.handle })],
      });
      expect(
        (
          await relay.dispatchFetch(
            `https://kaioken.app/api/connect/login/${second.id}/cancel`,
            { method: "POST", headers: { "x-kaioken-login-proof": proofB } },
          )
        ).status,
      ).toBe(200);
      expect((await complete(relay, second.id, proofB)).status).toBe(403);
      expect(
        (
          await relay.dispatchFetch("https://kaioken.app/api/connect/servers", {
            headers: { "x-bb-connect-machine": proofB },
          })
        ).status,
      ).toBe(401);
      socket.close();
    } finally {
      await relay.dispose();
    }
  });

  it("deduplicates registration retries at the account boundary and never restores revoked access", async () => {
    const relay = fixture();
    try {
      const namespace = await relay.getDurableObjectNamespace("ACCOUNT_DO");
      const account = namespace.get(namespace.idFromName("personal"));
      const hash = await sha256Hex(proofA);
      const register = () =>
        account.fetch("https://account/command", {
          method: "POST",
          body: JSON.stringify({
            method: "registerDevice",
            args: ["Mac Studio", hash, null],
          }),
        });
      const first = await (await register()).json();
      expect(await (await register()).json()).toEqual(first);
      const listed = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/servers",
        { headers: { "x-bb-connect-machine": proofA } },
      );
      expect(await listed.json()).toMatchObject({
        servers: [expect.objectContaining({ name: "Mac Studio" })],
      });
      const cancelled = await account.fetch("https://account/command", {
        method: "POST",
        body: JSON.stringify({ method: "cancelRegistration", args: [hash] }),
      });
      expect(await cancelled.json()).toEqual(expect.any(String));
      expect(await (await register()).json()).toBeNull();
      expect(
        (
          await relay.dispatchFetch("https://kaioken.app/api/connect/servers", {
            headers: { "x-bb-connect-machine": proofA },
          })
        ).status,
      ).toBe(401);
    } finally {
      await relay.dispose();
    }
  });

  it("binds callbacks to their browser and rejects an unapproved GitHub identity", async () => {
    const relay = fixture(99);
    try {
      const login = await begin(relay, proofA);
      expect((await relay.dispatchFetch(login.callback)).status).toBe(403);
      const wrongState = new URL(login.callback);
      wrongState.searchParams.set("state", `${login.id}.wrong`);
      expect(
        (
          await relay.dispatchFetch(wrongState, {
            headers: { cookie: login.cookie },
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await relay.dispatchFetch(login.callback, {
            headers: { cookie: login.cookie },
          })
        ).status,
      ).toBe(403);
      expect((await complete(relay, login.id, proofA)).status).toBe(403);
      expect(
        (
          await relay.dispatchFetch("https://kaioken.app/api/connect/servers", {
            headers: { "x-bb-connect-machine": proofA },
          })
        ).status,
      ).toBe(401);
    } finally {
      await relay.dispose();
    }
  });

  it("blocks browser CSRF, cancels pending sign-ins, and rejects missing service configuration", async () => {
    const unavailable = await domainMf.dispatchFetch(
      "https://kaioken.app/api/connect/login",
      { method: "POST", body: "{}" },
    );
    expect(unavailable.status).toBe(503);
    const relay = fixture();
    try {
      const response = await relay.dispatchFetch(
        "https://kaioken.app/api/connect/login",
        {
          method: "POST",
          body: JSON.stringify({
            name: "My Mac",
            challenge: await sha256Hex(proofA),
            previous: null,
          }),
        },
      );
      const login = connectLoginStartSchema.parse(await response.json());
      const browser = await relay.dispatchFetch(login.browserUrl);
      const cookie = browser.headers.get("set-cookie")!.split(";")[0]!;
      expect(
        (
          await relay.dispatchFetch(login.browserUrl, {
            method: "POST",
            headers: {
              cookie,
              "content-type": "application/x-www-form-urlencoded",
            },
            body: "csrf=wrong",
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await relay.dispatchFetch(
            `https://kaioken.app/api/connect/login/${login.id}/cancel`,
            { method: "POST", headers: { "x-kaioken-login-proof": proofA } },
          )
        ).status,
      ).toBe(200);
      expect((await complete(relay, login.id, proofA)).status).toBe(403);
    } finally {
      await relay.dispose();
    }
  });
});
