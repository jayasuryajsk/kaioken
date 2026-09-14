import { describe, expect, it, vi } from "vitest";
import {
  createFederatedFetchHandler,
  isAllowedFederatedUrl,
  sanitizeFederatedHeaders,
  type FederatedFetchImpl,
} from "../src/desktop-federation-main-ipc.js";

vi.mock("electron", () => ({ ipcMain: { handle: vi.fn() } }));

const SERVERS = [{ url: "https://mini.kaioken.app" }];

function fakeFetch(
  status = 200,
  body = '{"ok":true}',
  headers: Array<[string, string]> = [["content-type", "application/json"]],
) {
  const calls: Parameters<FederatedFetchImpl>[] = [];
  const impl: FederatedFetchImpl = async (...args) => {
    calls.push(args);
    return {
      status,
      headers: {
        forEach(callback) {
          for (const [key, value] of headers) callback(value, key);
        },
      },
      text: async () => body,
    };
  };
  return { impl, calls };
}

describe("isAllowedFederatedUrl", () => {
  it("allows known origins and sibling handles under the same account domain only over https", () => {
    expect(
      isAllowedFederatedUrl(
        new URL("https://mini.kaioken.app/api/v1/x"),
        SERVERS,
      ),
    ).toBe(true);
    expect(
      isAllowedFederatedUrl(
        new URL("https://work.kaioken.app/api/v1/x"),
        SERVERS,
      ),
    ).toBe(true);
    expect(
      isAllowedFederatedUrl(
        new URL("http://mini.kaioken.app/api/v1/x"),
        SERVERS,
      ),
    ).toBe(false);
    expect(
      isAllowedFederatedUrl(
        new URL("https://kaioken.app/api/connect/servers"),
        SERVERS,
      ),
    ).toBe(false);
    expect(
      isAllowedFederatedUrl(new URL("https://evil.example/api/v1/x"), SERVERS),
    ).toBe(false);
    expect(
      isAllowedFederatedUrl(
        new URL("https://mini.kaioken.app.evil.example/"),
        SERVERS,
      ),
    ).toBe(false);
    expect(
      isAllowedFederatedUrl(new URL("https://mini.kaioken.app/"), []),
    ).toBe(false);
  });
});

describe("createFederatedFetchHandler", () => {
  it("fetches with the session cookies and never forwards renderer credentials", async () => {
    const { impl, calls } = fakeFetch();
    const handler = createFederatedFetchHandler({
      listServers: () => SERVERS,
      fetchImpl: impl,
    });
    const response = await handler({
      url: "https://mini.kaioken.app/api/v1/sidebar-bootstrap",
      method: "GET",
      headers: {
        Accept: "application/json",
        Cookie: "stolen=1",
        Authorization: "Bearer nope",
        "x-bb-connect-machine": "bbcm_nope",
      },
    });
    expect(response).toEqual({
      status: 200,
      headers: [["content-type", "application/json"]],
      body: '{"ok":true}',
    });
    expect(calls).toHaveLength(1);
    const [url, init] = calls[0]!;
    expect(url).toBe("https://mini.kaioken.app/api/v1/sidebar-bootstrap");
    expect(init.credentials).toBe("include");
    expect(init.method).toBe("GET");
    expect(init.headers).toEqual({ accept: "application/json" });
  });

  it("drops set-cookie from the response and skips the body for HEAD", async () => {
    const { impl } = fakeFetch(204, "ignored", [
      ["set-cookie", "secret=1"],
      ["etag", "abc"],
    ]);
    const handler = createFederatedFetchHandler({
      listServers: () => SERVERS,
      fetchImpl: impl,
    });
    await expect(
      handler({
        url: "https://mini.kaioken.app/api/v1/threads",
        method: "HEAD",
      }),
    ).resolves.toEqual({ status: 204, headers: [["etag", "abc"]], body: "" });
  });

  it("refuses unknown origins, non-read methods, malformed payloads, and oversized bodies", async () => {
    const { impl, calls } = fakeFetch(200, "x".repeat(32));
    const handler = createFederatedFetchHandler({
      listServers: () => SERVERS,
      fetchImpl: impl,
      maxBodyBytes: 16,
    });
    await expect(
      handler({ url: "https://evil.example/api/v1/x" }),
    ).rejects.toThrow(/refused/);
    await expect(
      handler({ url: "https://mini.kaioken.app/api/v1/x", method: "POST" }),
    ).rejects.toThrow(/malformed/);
    await expect(handler("https://mini.kaioken.app/api/v1/x")).rejects.toThrow(
      /malformed/,
    );
    expect(calls).toHaveLength(0);
    await expect(
      handler({ url: "https://mini.kaioken.app/api/v1/x" }),
    ).rejects.toThrow(/size limit/);
  });

  it("returns the upstream status for an offline server instead of throwing", async () => {
    const { impl } = fakeFetch(503, "offline", []);
    const handler = createFederatedFetchHandler({
      listServers: () => SERVERS,
      fetchImpl: impl,
    });
    await expect(
      handler({ url: "https://mini.kaioken.app/api/v1/x" }),
    ).resolves.toEqual({
      status: 503,
      headers: [],
      body: "offline",
    });
  });

  it("lower-cases header names while sanitizing", () => {
    expect(
      sanitizeFederatedHeaders({
        "X-Kaioken-App-Surface": "desktop",
        HOST: "x",
      }),
    ).toEqual({
      "x-kaioken-app-surface": "desktop",
    });
  });
});

describe("federated fetch preparation", () => {
  it("runs prepare before deciding whether the origin is allowed", async () => {
    const servers: { url: string }[] = [];
    const order: string[] = [];
    const handler = createFederatedFetchHandler({
      listServers: () => servers,
      prepare: async () => {
        order.push("prepare");
        servers.push({ url: "https://studio.kaioken.app" });
      },
      fetchImpl: async () => {
        order.push("fetch");
        return {
          status: 200,
          headers: { forEach: () => undefined },
          text: async () => "{}",
        };
      },
    });
    const result = await handler({
      url: "https://studio.kaioken.app/api/v1/threads",
      method: "GET",
      headers: {},
    });
    expect(result.status).toBe(200);
    expect(order).toEqual(["prepare", "fetch"]);
  });

  it("reports an unreachable session instead of throwing when prepare fails", async () => {
    const handler = createFederatedFetchHandler({
      listServers: () => [{ url: "https://studio.kaioken.app" }],
      prepare: async () => {
        throw new Error("local server down");
      },
      fetchImpl: async () => {
        throw new Error("should not fetch");
      },
    });
    const result = await handler({
      url: "https://studio.kaioken.app/api/v1/threads",
      method: "GET",
      headers: {},
    });
    expect(result.status).toBe(0);
  });
});
