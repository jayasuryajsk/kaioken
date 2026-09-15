// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { KaiokenDesktopApi } from "@kaioken/desktop-contract";
import { createRemoteFetch, resolveRemoteFetchMode } from "./remote-fetch";
import { updateSshTargets } from "./ssh-targets";
import { rememberConnectionIdentity } from "./connection-identities";

function installBridge() {
  const federatedFetch = vi.fn<
    NonNullable<KaiokenDesktopApi["federatedFetch"]>
  >(async () => ({
    status: 200,
    headers: [["content-type", "application/json"]] as Array<[string, string]>,
    body: '{"ok":true}',
  }));
  window.kaiokenDesktop = { federatedFetch } as unknown as KaiokenDesktopApi;
  return federatedFetch;
}

afterEach(() => {
  delete window.kaiokenDesktop;
  vi.unstubAllGlobals();
  updateSshTargets([]);
  localStorage.clear();
});

describe("createRemoteFetch through the desktop bridge", () => {
  it("pins workspace requests to the remembered installation", async () => {
    const bridge = installBridge();
    const serverId = "ab2d59e2-2f77-4272-9242-a3351d2ef44b";
    rememberConnectionIdentity("https://mini.kaioken.app", serverId);
    await createRemoteFetch()("https://mini.kaioken.app/api/v1/projects");
    expect(bridge).toHaveBeenCalledWith(
      expect.objectContaining({ headers: { "x-kaioken-server-id": serverId } }),
    );
    await createRemoteFetch()(
      "https://mini.kaioken.app/api/v1/connections/self",
    );
    expect(bridge).toHaveBeenLastCalledWith(
      expect.objectContaining({ headers: {} }),
    );
  });

  it("uses the controller for a browser's known SSH tunnel and preserves binary data", async () => {
    updateSshTargets([
      {
        alias: "work",
        remotePort: 38886,
        url: "http://127.0.0.1:41234",
        state: "ready",
        error: null,
      },
    ]);
    const fetchMock = vi.fn(async () =>
      Response.json({
        status: 200,
        headers: { "content-type": "application/octet-stream" },
        body: "AP8=",
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const response = await createRemoteFetch("browser-cookie")(
      "http://127.0.0.1:41234/api/v1/files?path=a",
      { method: "PUT", body: new Uint8Array([0, 255]) },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/v1/connections/ssh/request",
      expect.objectContaining({
        body: JSON.stringify({
          alias: "work",
          path: "/api/v1/files?path=a",
          method: "PUT",
          headers: {},
          body: "AP8=",
        }),
      }),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0, 255]),
    );
  });
  it("round-trips binary uploads and downloads without decoding bytes as text", async () => {
    const federatedFetch = installBridge();
    window.kaiokenDesktop!.federatedTransportVersion = 2;
    federatedFetch.mockResolvedValue({
      status: 200,
      headers: [],
      body: "AP9/gA==",
      bodyEncoding: "base64",
    });
    const response = await createRemoteFetch()(
      new Request("https://mini.kaioken.app/api/v1/upload", {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body: new Uint8Array([0, 255, 127, 128]),
      }),
    );
    expect(federatedFetch).toHaveBeenCalledWith(
      expect.objectContaining({
        method: "PUT",
        body: "AP9/gA==",
        bodyEncoding: "base64",
        responseEncoding: "base64",
      }),
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([0, 255, 127, 128]),
    );
  });

  it("serializes multipart data with its generated boundary", async () => {
    const federatedFetch = installBridge();
    window.kaiokenDesktop!.federatedTransportVersion = 2;
    const data = new FormData();
    data.set("name", "résumé.txt");
    await createRemoteFetch()("https://mini.kaioken.app/api/v1/upload", {
      method: "POST",
      body: data,
    });
    const request = federatedFetch.mock.calls[0]?.[0];
    expect(request).toEqual(
      expect.objectContaining({
        bodyEncoding: "base64",
        headers: expect.objectContaining({
          "content-type": expect.stringContaining(
            "multipart/form-data; boundary=",
          ),
        }),
      }),
    );
  });

  it("does not dispatch an aborted request and accepts empty successful responses", async () => {
    const federatedFetch = installBridge();
    const controller = new AbortController();
    controller.abort();
    await expect(
      createRemoteFetch()("https://mini.kaioken.app/api/v1/x", {
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: "AbortError" });
    expect(federatedFetch).not.toHaveBeenCalled();
    federatedFetch.mockResolvedValue({ status: 204, headers: [], body: "" });
    expect(
      (await createRemoteFetch()("https://mini.kaioken.app/api/v1/x")).status,
    ).toBe(204);
  });

  it("passes write methods with their JSON body to the bridge", async () => {
    const federatedFetch = installBridge();
    expect(resolveRemoteFetchMode()).toBe("desktop-bridge");
    const remoteFetch = createRemoteFetch();
    const body = JSON.stringify({ input: [{ type: "text", text: "hi" }] });
    const response = await remoteFetch(
      "https://mini.kaioken.app/api/v1/threads/thr_1/send",
      {
        method: "post",
        headers: { "content-type": "application/json" },
        body,
      },
    );
    expect(await response.json()).toEqual({ ok: true });
    expect(federatedFetch).toHaveBeenCalledWith({
      url: "https://mini.kaioken.app/api/v1/threads/thr_1/send",
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  });

  it("omits the body for reads and requires a desktop update for binary uploads", async () => {
    const federatedFetch = installBridge();
    const remoteFetch = createRemoteFetch();
    await remoteFetch(new URL("https://mini.kaioken.app/api/v1/threads/thr_1"));
    expect(federatedFetch).toHaveBeenLastCalledWith({
      url: "https://mini.kaioken.app/api/v1/threads/thr_1",
      method: "GET",
      headers: {},
    });
    await expect(
      remoteFetch("https://mini.kaioken.app/api/v1/upload", {
        method: "POST",
        body: new FormData(),
      }),
    ).rejects.toThrow(/Update the desktop app/);
    await expect(
      remoteFetch("https://mini.kaioken.app/api/v1/x", { method: "TRACE" }),
    ).rejects.toThrow(/TRACE/);
    expect(federatedFetch).toHaveBeenCalledTimes(1);
  });
});

describe("createRemoteFetch in a browser", () => {
  it("sends credentialed CORS requests for writes too", async () => {
    const fetchMock = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    expect(resolveRemoteFetchMode()).toBe("browser-cookie");
    await createRemoteFetch()(
      "https://mini.kaioken.app/api/v1/threads/thr_1/stop",
      {
        method: "POST",
      },
    );
    expect(fetchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        url: "https://mini.kaioken.app/api/v1/threads/thr_1/stop",
        method: "POST",
      }),
      { credentials: "include", mode: "cors" },
    );
  });
});
