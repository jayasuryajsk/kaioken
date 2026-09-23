// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { RemoteRoute } from "./RemoteRoute";
import {
  readConnectionIdentity,
  rememberConnectionIdentity,
} from "./connection-identities";

const fixtures = vi.hoisted(() => ({
  server: {
    handle: "mini",
    name: "Mini",
    url: "https://mini.kaioken.app",
    home: false,
    live: true,
    lastSeenAt: null,
  },
  self: vi.fn(),
  subscribe: vi.fn(() => () => {}),
}));
vi.mock("@/hooks/queries/federation-queries", () => ({
  useConnectedComputers: () => [fixtures.server],
}));
vi.mock("./remote-sdk", () => ({
  getRemoteSdk: () => ({
    experimental_connections: { self: fixtures.self },
    subscribe: fixtures.subscribe,
  }),
}));
const id = "74bcf65a-a849-4577-9a6f-c9b540940afb";
beforeEach(() => {
  fixtures.server.live = true;
  fixtures.self.mockReset().mockResolvedValue({ serverId: id });
});
afterEach(() => {
  cleanup();
  localStorage.clear();
});
const seenClients: QueryClient[] = [];
function ScopedChild() {
  seenClients.push(useQueryClient());
  return <button>Reply</button>;
}
function open() {
  const harness = createQueryClientTestHarness();
  const { wrapper } = harness;
  return render(
    <MemoryRouter initialEntries={["/servers/mini/threads/thr_1"]}>
      <Routes>
        <Route
          path="/servers/:handle/threads/:threadId"
          element={
            <RemoteRoute>
              <ScopedChild />
            </RemoteRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
    { wrapper },
  );
}
it("verifies and pins the owning machine before rendering native actions", async () => {
  const view = open();
  await screen.findByRole("button", { name: "Reply" });
  expect(readConnectionIdentity(fixtures.server.url, "mini")).toBe(id);
  expect(view.container.querySelector("iframe")).toBeNull();
});
it("blocks actions until a changed machine identity is explicitly trusted", async () => {
  rememberConnectionIdentity(
    fixtures.server.url,
    "2d0e29d5-3490-439d-a604-f51cc632551f",
    "mini",
  );
  open();
  fireEvent.click(
    await screen.findByRole("button", { name: "Trust this computer" }),
  );
  await screen.findByRole("button", { name: "Reply" });
  expect(readConnectionIdentity(fixtures.server.url, "mini")).toBe(id);
});
it("keeps offline machines visible without sending requests", async () => {
  fixtures.server.live = false;
  open();
  expect(screen.getByRole("status").textContent).toContain("Mini is offline");
  expect(screen.queryByRole("button", { name: "Reply" })).toBeNull();
  expect(fixtures.self).not.toHaveBeenCalled();
});
it("gives the other computer its own cache and live-update stream", async () => {
  seenClients.length = 0;
  const harness = createQueryClientTestHarness();
  render(
    <MemoryRouter initialEntries={["/servers/mini/threads/thr_1"]}>
      <Routes>
        <Route
          path="/servers/:handle/threads/:threadId"
          element={
            <RemoteRoute>
              <ScopedChild />
            </RemoteRoute>
          }
        />
      </Routes>
    </MemoryRouter>,
    { wrapper: harness.wrapper },
  );
  await screen.findByRole("button", { name: "Reply" });
  expect(seenClients.at(-1)).not.toBe(harness.queryClient);
  const events = fixtures.subscribe.mock.calls.map(
    (call) => (call as unknown as [{ event: string }])[0].event,
  );
  expect(events).toEqual(
    expect.arrayContaining(["thread:changed", "realtime:connection"]),
  );
});
