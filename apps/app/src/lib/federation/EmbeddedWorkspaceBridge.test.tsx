// @vitest-environment jsdom

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { EmbeddedWorkspaceBridge } from "./EmbeddedWorkspaceBridge";
import { getDesktopBrowserApi } from "../kaioken-desktop";

const fixtures = vi.hoisted(() => ({
  serverId: "74bcf65a-a849-4577-9a6f-c9b540940afb",
  nonce: "2d0e29d5-3490-439d-a604-f51cc632551f",
}));
vi.mock("./workspace-protocol", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./workspace-protocol")>()),
  workspaceEmbedding: {
    origin: window.location.origin,
    serverId: fixtures.serverId,
    nonce: fixtures.nonce,
  },
}));
vi.mock("@/lib/sdk", () => ({
  sdk: {
    experimental_connections: {
      self: async () => ({
        serverId: fixtures.serverId,
        primaryHostId: null,
        workspaceProtocol: 1,
      }),
    },
  },
}));
vi.mock("@/hooks/queries/federation-queries", () => ({
  useAccountServers: () => ({ data: [] }),
}));
vi.mock("@/hooks/useServerConnectionState", () => ({
  useServerConnectionState: () => "connected",
}));

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Location() {
  const location = useLocation();
  return <output>{location.pathname}</output>;
}

it("keeps one controller handshake across route changes and ignores untrusted navigation", async () => {
  const post = vi.spyOn(window, "postMessage").mockImplementation(() => {});
  const { wrapper } = createQueryClientTestHarness();
  render(
    <MemoryRouter>
      <EmbeddedWorkspaceBridge>
        <span>Workspace ready</span>
      </EmbeddedWorkspaceBridge>
      <Location />
    </MemoryRouter>,
    { wrapper },
  );
  const readyMessages = () =>
    post.mock.calls.filter(
      ([message]) => message.type === "kaioken:workspace-ready",
    );
  await waitFor(() => expect(readyMessages()).toHaveLength(1));
  expect(screen.queryByText("Workspace ready")).toBeNull();
  expect(getDesktopBrowserApi()).toBeNull();
  const navigate = (origin: string, nonce: string, path: string) =>
    window.dispatchEvent(
      new MessageEvent("message", {
        source: window,
        origin,
        data: {
          type: "kaioken:workspace-navigate",
          nonce,
          navigationId: "navigation",
          path,
          desktopBrowser: true,
        },
      }),
    );
  act(() => navigate("https://unrelated.example", fixtures.nonce, "/wrong"));
  expect(screen.getByRole("status").textContent).toBe("/");
  act(() =>
    navigate(window.location.origin, fixtures.nonce, "/projects/proj_remote"),
  );
  await waitFor(() =>
    expect(screen.getByRole("status").textContent).toBe(
      "/projects/proj_remote",
    ),
  );
  expect(readyMessages()).toHaveLength(1);
  expect(screen.getByText("Workspace ready")).toBeTruthy();
  expect(getDesktopBrowserApi()).not.toBeNull();
});
