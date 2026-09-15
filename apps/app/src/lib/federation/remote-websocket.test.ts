// @vitest-environment jsdom

import { afterEach, describe, expect, it, vi } from "vitest";
import type {
  FederatedSocketEvent,
  KaiokenDesktopApi,
} from "@kaioken/desktop-contract";
import { createRemoteWebsocket } from "./remote-websocket";

afterEach(() => {
  delete window.kaiokenDesktop;
});

describe("remote realtime bridge", () => {
  it("scopes events to one socket and disposes listeners on close", () => {
    let listener: (event: FederatedSocketEvent) => void = () => {};
    const unsubscribe = vi.fn();
    const bridge = {
      open: vi.fn(async (_request: { id: string; url: string }) => {}),
      send: vi.fn(),
      close: vi.fn(),
      subscribe: vi.fn((callback: typeof listener) => {
        listener = callback;
        return unsubscribe;
      }),
    };
    window.kaiokenDesktop = {
      federatedSocket: bridge,
    } as unknown as KaiokenDesktopApi;
    const socket = createRemoteWebsocket("wss://mini.kaioken.app/ws");
    const onopen = vi.fn();
    socket.onopen = onopen;
    const id = bridge.open.mock.calls[0]![0].id;
    listener({ id: crypto.randomUUID(), type: "open" });
    expect(onopen).not.toHaveBeenCalled();
    listener({ id, type: "open" });
    expect(socket.readyState).toBe(1);
    socket.send("subscribe");
    expect(bridge.send).toHaveBeenCalledWith({ id, data: "subscribe" });
    socket.close();
    listener({ id, type: "open" });
    expect(socket.readyState).toBe(3);
    expect(unsubscribe).toHaveBeenCalledOnce();
    expect(onopen).toHaveBeenCalledOnce();
  });

  it("allows a failed connection to close and be retried by the SDK", async () => {
    const unsubscribe = vi.fn();
    window.kaiokenDesktop = {
      federatedSocket: {
        open: async () => {
          throw new Error("Sign-in required");
        },
        send: vi.fn(),
        close: vi.fn(),
        subscribe: () => unsubscribe,
      },
    } as unknown as KaiokenDesktopApi;
    const socket = createRemoteWebsocket("wss://mini.kaioken.app/ws");
    socket.onerror = vi.fn();
    socket.onclose = vi.fn();
    await Promise.resolve();
    expect(socket.onerror).toHaveBeenCalledOnce();
    expect(socket.onclose).toHaveBeenCalledOnce();
    expect(unsubscribe).toHaveBeenCalledOnce();
  });
});
