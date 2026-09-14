import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Miniflare } from "miniflare";
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

function createRelay(bindings: Record<string, string>): Miniflare {
  return new Miniflare({
    modules: [{ type: "ESModule", path: "/worker.mjs", contents: bundleText }],
    modulesRoot: "/",
    scriptPath: "/worker.mjs",
    compatibilityDate: "2026-06-11",
    compatibilityFlags: ["nodejs_compat"],
    durableObjects: {
      TUNNEL_DO: "TunnelDO",
      PAIRING_LIMITER: "PairingLimiter",
    },
    kvNamespaces: ["STATE"],
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
    const kv = await domainMf.getKVNamespace("STATE");
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

    const dial = await host("legacyhost", "/__tunnel?v=1", {
      headers: { authorization: `Bearer ${credential}` },
    });
    expect(dial.status).toBe(426);
    expect(await kv.get("server", "text")).toBeNull();
    expect(
      JSON.parse((await kv.get("server:legacyhost", "text")) ?? "null") as {
        handle: string;
      },
    ).toMatchObject({
      credentialHash: hash,
      handle: "legacyhost",
      pairedAt: 5,
    });
    const listed = await apex("/api/connect/servers", {
      headers: { "x-bb-connect-machine": credential },
    });
    expect(
      ((await listed.json()) as { servers: { handle: string }[] }).servers.map(
        (s) => s.handle,
      ),
    ).toContain("legacyhost");
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
