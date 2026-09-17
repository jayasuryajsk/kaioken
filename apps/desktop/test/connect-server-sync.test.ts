import { describe, expect, it, vi } from "vitest";
import {
  createConnectServerSync,
  fetchConnectAccountServers,
  selectTargetableConnectServers,
  type ConnectAccountServer,
} from "../src/connect-server-sync.js";

describe("fetchConnectAccountServers", () => {
  it("POSTs the local plugin RPC path and Zod-parses the result", async () => {
    const fetchImpl = vi.fn(async (input: string, init?: RequestInit) => {
      expect(input).toBe(
        "http://127.0.0.1:38886/api/v1/plugins/connect/rpc/listAccountServers",
      );
      expect(init?.method).toBe("POST");
      expect(init?.headers).toEqual({ "content-type": "application/json" });
      expect(init?.body).toBe("null");
      return {
        ok: true,
        status: 200,
        json: async () => ({
          ok: true,
          result: {
            selfHandle: "me",
            servers: [
              {
                handle: "me",
                name: "primary",
                live: true,
                url: "https://me.getbb.app",
              },
              {
                handle: "other",
                name: "laptop",
                live: false,
                url: "https://other.getbb.app",
              },
            ],
          },
        }),
        text: async () => "",
      };
    });

    const result = await fetchConnectAccountServers({
      serverUrl: "http://127.0.0.1:38886/",
      fetchImpl,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) {
      throw new Error(`unexpected skip: ${result.reason}`);
    }
    expect(result.result.selfHandle).toBe("me");
    expect(result.result.servers).toHaveLength(2);
  });

  it("names the reason on network failure, plugin disabled, or not paired", async () => {
    await expect(
      fetchConnectAccountServers({
        serverUrl: "http://127.0.0.1:1",
        fetchImpl: async () => {
          throw new Error("ECONNREFUSED");
        },
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });

    await expect(
      fetchConnectAccountServers({
        serverUrl: "http://127.0.0.1:38886",
        fetchImpl: async () => ({
          ok: false,
          status: 503,
          json: async () => ({
            ok: false,
            error: 'plugin "connect" is not running (status: disabled)',
          }),
          text: async () => "",
        }),
      }),
    ).resolves.toEqual({ ok: false, reason: "plugin-disabled" });

    await expect(
      fetchConnectAccountServers({
        serverUrl: "http://127.0.0.1:38886",
        fetchImpl: async () => ({
          ok: false,
          status: 500,
          json: async () => ({
            ok: false,
            error: { code: "handler_error", message: "not_paired" },
          }),
          text: async () => "",
        }),
      }),
    ).resolves.toEqual({ ok: false, reason: "not-paired" });

    await expect(
      fetchConnectAccountServers({
        serverUrl: "http://127.0.0.1:38886",
        fetchImpl: async () => ({
          ok: false,
          status: 500,
          json: async () => ({
            ok: false,
            error: { code: "handler_error", message: "network" },
          }),
          text: async () => "",
        }),
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
    await expect(
      fetchConnectAccountServers({
        serverUrl: "http://127.0.0.1:38886",
        fetchImpl: async () => ({
          ok: false,
          status: 502,
          json: async () => {
            throw new SyntaxError("not json");
          },
          text: async () => "",
        }),
      }),
    ).resolves.toEqual({ ok: false, reason: "unavailable" });
  });
});

describe("selectTargetableConnectServers", () => {
  it("drops the self handle and keeps everything else, live or not", () => {
    const servers = selectTargetableConnectServers({
      selfHandle: "me",
      servers: [
        { handle: "me", name: "primary", live: true, url: "https://me.x" },
        { handle: "laptop", name: "Laptop", live: true, url: "https://l.x" },
        { handle: "phone", name: "Phone", live: false, url: "https://p.x" },
      ],
    });
    expect(servers.map((server) => server.handle)).toEqual(["laptop", "phone"]);
  });
});

describe("createConnectServerSync", () => {
  it("does not replace a pushed snapshot with an older HTTP result", async () => {
    let resolveResponse!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => {
      resolveResponse = resolve;
    });
    const onServers = vi.fn();
    const sync = createConnectServerSync({
      getCredential: () => null,
      getLocalServerUrl: () => "http://127.0.0.1:38886",
      onServers,
      onSkipped: vi.fn(),
      onUnauthorized: vi.fn(),
      fetchImpl: () => pending,
    });
    const request = sync.syncNow();
    const servers = [
      {
        handle: "book",
        name: "MacBook",
        live: true,
        url: "https://book.kaioken.app",
      },
    ];
    sync.onSnapshot({ selfHandle: "studio", servers });
    resolveResponse(
      new Response(
        JSON.stringify({
          ok: true,
          result: { selfHandle: "studio", servers: [] },
        }),
      ),
    );
    await request;
    expect(onServers).toHaveBeenCalledExactlyOnceWith(servers);
  });

  it("shares one remote subscription and stops it when the local runtime takes over", async () => {
    const credential = {
      credential: "bbcm_test",
      handle: "studio",
      serverUrl: "https://studio.kaioken.app",
    };
    const servers = [
      {
        handle: "book",
        name: "MacBook",
        live: true,
        url: "https://book.kaioken.app",
      },
    ];
    let local: string | null = null;
    let disconnected = () => undefined;
    const stop = vi.fn();
    const subscribeRemote = vi.fn((_credential, onSnapshot, onDisconnected) => {
      disconnected = onDisconnected;
      onSnapshot({ selfHandle: "studio", servers });
      return stop;
    });
    const onServers = vi.fn();
    const sync = createConnectServerSync({
      getCredential: () => credential,
      getLocalServerUrl: () => local,
      subscribeRemote,
      onServers,
      onSkipped: vi.fn(),
      onUnauthorized: vi.fn(),
      gateFetchImpl: async () => new Response(JSON.stringify({ servers })),
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            ok: true,
            result: { selfHandle: "studio", servers },
          }),
        ),
    });
    await sync.syncNow();
    await sync.syncNow();
    expect(subscribeRemote).toHaveBeenCalledOnce();
    disconnected();
    expect(onServers).toHaveBeenLastCalledWith([
      { ...servers[0], live: false },
    ]);
    local = "http://127.0.0.1:38886";
    await sync.syncNow();
    expect(stop).toHaveBeenCalledOnce();
    sync.stop();
    expect(stop).toHaveBeenCalledOnce();
  });

  it("hands fresh servers to onServers and skips list trigger within the min interval", async () => {
    let now = 1_000_000;
    let received: ConnectAccountServer[] | null = null;
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        ok: true,
        result: {
          selfHandle: "me",
          servers: [
            {
              handle: "other",
              name: "Other",
              live: true,
              url: "https://other.getbb.app",
            },
          ],
        },
      }),
      text: async () => "",
    }));

    const sync = createConnectServerSync({
      getCredential: () => null,
      getLocalServerUrl: () => "http://127.0.0.1:38886",
      onServers(servers) {
        received = servers;
      },
      onSkipped: () => undefined,
      onUnauthorized: () => undefined,
      fetchImpl,
      now: () => now,
      minIntervalMs: 60_000,
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(received).toEqual([
      {
        handle: "other",
        name: "Other",
        live: true,
        url: "https://other.getbb.app",
      },
    ]);

    now += 10_000;
    sync.onListRequested();
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    now += 60_000;
    const listSync = new Promise<void>((resolve) => {
      sync.onListRequested();
      void sync.syncNow().then(resolve);
    });
    await listSync;
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("reports each skipped sync with its reason and logs once per failure streak", async () => {
    const logs: string[] = [];
    const skipped: string[] = [];
    let onServersCalls = 0;
    let mode: "down" | "disabled" | "up" = "down";
    const fetchImpl = vi.fn(
      async (): Promise<Pick<Response, "ok" | "status" | "json" | "text">> => {
        if (mode === "down") {
          throw new Error("down");
        }
        if (mode === "disabled") {
          return {
            ok: false,
            status: 503,
            json: async () => ({ ok: false, error: "plugin not running" }),
            text: async () => "",
          };
        }
        return {
          ok: true,
          status: 200,
          json: async () => ({
            ok: true,
            result: { selfHandle: "me", servers: [] },
          }),
          text: async () => "",
        };
      },
    );

    const sync = createConnectServerSync({
      getCredential: () => null,
      getLocalServerUrl: () => "http://127.0.0.1:38886",
      onServers() {
        onServersCalls += 1;
      },
      onSkipped(reason) {
        skipped.push(reason);
      },
      onUnauthorized: () => undefined,
      fetchImpl,
      log: (message) => {
        logs.push(message);
      },
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    await sync.syncNow();
    expect(skipped).toEqual(["unavailable", "unavailable"]);
    expect(logs).toEqual(["connect server sync skipped (unavailable)"]);
    expect(onServersCalls).toBe(0);

    mode = "disabled";
    await sync.syncNow();
    expect(skipped).toEqual(["unavailable", "unavailable", "plugin-disabled"]);
    expect(logs).toEqual([
      "connect server sync skipped (unavailable)",
      "connect server sync skipped (plugin-disabled)",
    ]);

    mode = "up";
    await sync.syncNow();
    expect(onServersCalls).toBe(1);
    mode = "disabled";
    await sync.syncNow();
    expect(logs).toHaveLength(3);
  });
});

describe("createConnectServerSync without a local server", () => {
  const credential = {
    credential: "bbcm_desktop",
    handle: "me",
    serverUrl: "https://me.getbb.app",
  };

  it("lists servers straight from the gate with the cached credential", async () => {
    let received: ConnectAccountServer[] | null = null;
    const gateFetchImpl = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            servers: [
              { handle: "me", name: "This Mac", live: true },
              { handle: "other", name: "Other", live: true },
            ],
          }),
        ),
    );

    const sync = createConnectServerSync({
      getCredential: () => credential,
      getLocalServerUrl: () => null,
      gateFetchImpl,
      onServers(servers) {
        received = servers;
      },
      onSkipped: () => undefined,
      onUnauthorized: () => undefined,
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(gateFetchImpl).toHaveBeenCalledWith(
      "https://me.getbb.app/api/connect/servers",
      expect.objectContaining({
        headers: { "x-bb-connect-machine": "bbcm_desktop" },
      }),
    );
    expect(received).toEqual([
      {
        handle: "other",
        name: "Other",
        live: true,
        url: "https://other.getbb.app",
      },
    ]);
  });

  it("reports a refused credential so the caller drops it", async () => {
    let unauthorized = 0;
    const skipped: string[] = [];
    const sync = createConnectServerSync({
      getCredential: () => credential,
      getLocalServerUrl: () => null,
      gateFetchImpl: async () => new Response("no", { status: 403 }),
      onServers: () => undefined,
      onSkipped(reason) {
        skipped.push(reason);
      },
      onUnauthorized() {
        unauthorized += 1;
      },
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(unauthorized).toBe(1);
    expect(skipped).toEqual(["unauthorized"]);
  });

  it("reports a gate outage as unavailable", async () => {
    const skipped: string[] = [];
    const sync = createConnectServerSync({
      getCredential: () => credential,
      getLocalServerUrl: () => null,
      gateFetchImpl: async () => new Response("oops", { status: 502 }),
      onServers: () => undefined,
      onSkipped(reason) {
        skipped.push(reason);
      },
      onUnauthorized: () => undefined,
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(skipped).toEqual(["unavailable"]);
  });

  it("reports no-credential without calling the gate when the app has none", async () => {
    const gateFetchImpl = vi.fn(async () => new Response("{}"));
    const skipped: string[] = [];
    const logs: string[] = [];
    const sync = createConnectServerSync({
      getCredential: () => null,
      getLocalServerUrl: () => null,
      gateFetchImpl,
      onServers: () => undefined,
      onSkipped(reason) {
        skipped.push(reason);
      },
      onUnauthorized: () => undefined,
      log: (message) => {
        logs.push(message);
      },
      setIntervalFn: () => 0,
      clearIntervalFn: () => undefined,
    });

    await sync.syncNow();
    expect(gateFetchImpl).not.toHaveBeenCalled();
    expect(skipped).toEqual(["no-credential"]);
    expect(logs).toEqual(["connect server sync skipped (no-credential)"]);
  });
});
