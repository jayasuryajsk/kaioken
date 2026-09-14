// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { KaiokenDesktopApi } from "@kaioken/desktop-contract";
import { createRemoteFetch, resolveRemoteFetchMode } from "./remote-fetch";

function installBridge() {
  const federatedFetch = vi.fn(async () => ({
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
});

describe("createRemoteFetch through the desktop bridge", () => {
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

  it("omits the body for reads and refuses non-text bodies and unknown methods", async () => {
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
    ).rejects.toThrow(/text body/);
    await expect(
      remoteFetch("https://mini.kaioken.app/api/v1/x", { method: "TRACE" }),
    ).rejects.toThrow(/cannot use TRACE/);
    expect(federatedFetch).toHaveBeenCalledTimes(1);
  });
});

describe("createRemoteFetch in a browser", () => {
  it("sends credentialed CORS requests for writes too", async () => {
    const fetchMock = vi.fn(
      async () => new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    expect(resolveRemoteFetchMode()).toBe("browser-cookie");
    await createRemoteFetch()("https://mini.kaioken.app/api/v1/threads/thr_1/stop", {
      method: "POST",
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://mini.kaioken.app/api/v1/threads/thr_1/stop",
      { method: "POST", credentials: "include", mode: "cors" },
    );
  });
});
