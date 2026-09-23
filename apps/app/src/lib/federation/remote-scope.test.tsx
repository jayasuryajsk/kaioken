// @vitest-environment jsdom
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk as localSdk } from "@/lib/sdk";
import { remoteTerminalSocketUrl } from "./remote-terminal-socket";
import { registerQueryClientSdk, sdkForQueryClient } from "./query-client-sdk";
import { RemoteServerProvider } from "./remote-server-context";
import { useScopedImageSrc } from "./scoped-image-src";

const remoteFetch = vi.hoisted(() => vi.fn());
vi.mock("./remote-fetch", () => ({ createRemoteFetch: () => remoteFetch }));

const server = {
  handle: "laptop",
  name: "MacBook",
  url: "https://laptop.kaioken.app",
  live: true,
  lastSeenAt: null,
  home: false,
};

afterEach(() => {
  remoteFetch.mockReset();
});

describe("remote scope plumbing", () => {
  it("builds terminal sockets against the owning computer", () => {
    expect(
      remoteTerminalSocketUrl(server.url, "/ws/terminals/term_1?cols=80"),
    ).toBe("wss://laptop.kaioken.app/ws/terminals/term_1?cols=80");
    expect(
      remoteTerminalSocketUrl("http://localhost:38886", "/ws/terminals/t"),
    ).toBe("ws://localhost:38886/ws/terminals/t");
  });

  it("looks up the connection that owns a cache, defaulting to this computer", () => {
    const remoteClient = new QueryClient();
    const remoteSdk = { marker: "remote" } as unknown as typeof localSdk;
    registerQueryClientSdk(remoteClient, remoteSdk);
    expect(sdkForQueryClient(remoteClient)).toBe(remoteSdk);
    expect(sdkForQueryClient(new QueryClient())).toBe(localSdk);
  });

  it("leaves local image URLs alone", () => {
    const { result } = renderHook(() =>
      useScopedImageSrc("/api/v1/threads/thr_1/files/a.png"),
    );
    expect(result.current).toBe("/api/v1/threads/thr_1/files/a.png");
  });

  it("loads another computer's images through its connection", async () => {
    remoteFetch.mockResolvedValue(new Response(new Blob(["png"])));
    const createObjectURL = vi.fn(() => "blob:remote-image");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL }));
    const wrapper = ({ children }: { children: ReactNode }) => (
      <RemoteServerProvider server={server}>{children}</RemoteServerProvider>
    );
    const { result } = renderHook(
      () => useScopedImageSrc("/api/v1/threads/thr_2/files/b.png"),
      { wrapper },
    );
    expect(result.current).toBeNull();
    await waitFor(() => expect(result.current).toBe("blob:remote-image"));
    expect(remoteFetch).toHaveBeenCalledWith(
      "https://laptop.kaioken.app/api/v1/threads/thr_2/files/b.png",
    );
    vi.unstubAllGlobals();
  });
});
