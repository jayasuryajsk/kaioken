import { QueryClient } from "@tanstack/react-query";
import type { KaiokenRealtimeSubscribeArgsUnion } from "@kaioken/sdk/browser";
import { afterEach, expect, it, vi } from "vitest";
import { subscribeRemoteSnapshot } from "./snapshot-subscription";

const fixtures = vi.hoisted(() => ({ subscribe: vi.fn(), stop: vi.fn() }));
vi.mock("./remote-sdk", () => ({
  getRemoteSdk: () => ({ subscribe: fixtures.subscribe }),
}));
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

it("shares one subscription across consumers and coalesces event bursts", () => {
  vi.useFakeTimers();
  const listeners: KaiokenRealtimeSubscribeArgsUnion[] = [];
  fixtures.subscribe.mockImplementation(
    (listener: KaiokenRealtimeSubscribeArgsUnion) => {
      listeners.push(listener);
      return fixtures.stop;
    },
  );
  const client = new QueryClient();
  const invalidate = vi.spyOn(client, "invalidateQueries");
  const stopSidebar = subscribeRemoteSnapshot(
    client,
    "mini",
    "https://mini.kaioken.app",
  );
  const stopSearch = subscribeRemoteSnapshot(
    client,
    "mini",
    "https://mini.kaioken.app",
  );
  expect(fixtures.subscribe).toHaveBeenCalledTimes(4);
  const connection = listeners.find(
    (listener) => listener.event === "realtime:connection",
  );
  if (connection?.event !== "realtime:connection")
    throw new Error("Missing listener");
  for (let i = 0; i < 20; i += 1)
    connection.callback({
      state: "connected",
      reconnected: true,
      reconnectDelayMs: null,
    });
  vi.advanceTimersByTime(300);
  expect(invalidate).toHaveBeenCalledTimes(1);
  expect(invalidate).toHaveBeenCalledWith(
    { queryKey: ["federation", "snapshot", "mini"] },
    { cancelRefetch: false },
  );
  stopSidebar();
  expect(fixtures.stop).not.toHaveBeenCalled();
  stopSearch();
  expect(fixtures.stop).toHaveBeenCalledTimes(4);
  client.clear();
});
