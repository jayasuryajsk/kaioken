// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, useLocation, useNavigate } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { RemoteWorkspaceDeck } from "./RemoteWorkspaceDeck";
import { rememberConnectionIdentity } from "@/lib/federation/connection-identities";

const fixtures = vi.hoisted(() => ({
  id: "74bcf65a-a849-4577-9a6f-c9b540940afb",
  servers: [
    {
      handle: "mini",
      name: "Mini",
      url: "https://mini.kaioken.app",
      live: true,
      home: false,
      lastSeenAt: null,
    },
  ],
}));

vi.mock("@/hooks/queries/federation-queries", () => ({
  useAccountServers: () => ({ data: fixtures.servers, isPending: false }),
  useConnectedComputers: () => fixtures.servers,
}));
vi.mock("@/lib/federation/remote-sdk", () => ({
  getRemoteSdk: () => ({
    experimental_connections: {
      self: async () => ({
        serverId: fixtures.id,
        primaryHostId: "host_remote",
        workspaceProtocol: 1,
      }),
    },
    threads: {
      get: async () => ({ id: "thr_remote", projectId: "proj_remote" }),
    },
  }),
}));

afterEach(() => {
  cleanup();
  localStorage.clear();
});

function Controls() {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <>
      <button onClick={() => navigate("/")}>Local</button>
      <button onClick={() => navigate("/servers/mini/workspace/")}>
        Remote
      </button>
      <output>{location.pathname}</output>
    </>
  );
}

describe("full connected workspace", () => {
  it("requires an explicit rebind before opening a replacement installation", async () => {
    rememberConnectionIdentity(
      "https://old-mini.kaioken.app",
      "2d0e29d5-3490-439d-a604-f51cc632551f",
      "mini",
    );
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/servers/mini/workspace/"]}>
        <RemoteWorkspaceDeck />
      </MemoryRouter>,
      { wrapper },
    );
    await screen.findByText("Computer identity changed");
    expect(screen.queryByTitle("Mini workspace")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect again" }));
    const frame = await screen.findByTitle<HTMLIFrameElement>("Mini workspace");
    expect(new URL(frame.src).searchParams.get("connectionServerId")).toBe(
      fixtures.id,
    );
  });
  it("keeps the same remote runtime when returning to the local workspace", async () => {
    const { wrapper } = createQueryClientTestHarness();
    render(
      <MemoryRouter initialEntries={["/servers/mini/threads/thr_remote"]}>
        <Controls />
        <RemoteWorkspaceDeck />
      </MemoryRouter>,
      { wrapper },
    );
    const frame = await screen.findByTitle<HTMLIFrameElement>("Mini workspace");
    const url = new URL(frame.src);
    expect(url.pathname).toBe("/projects/proj_remote/threads/thr_remote");
    const nonce = url.searchParams.get("connectionNonce");
    const notify = (origin: string, serverId: string) =>
      window.dispatchEvent(
        new MessageEvent("message", {
          source: frame.contentWindow,
          origin,
          data: {
            type: "kaioken:workspace-ready",
            nonce,
            navigationId: "",
            serverId,
          },
        }),
      );
    act(() => {
      notify("https://other.example", fixtures.id);
    });
    expect(frame.className).toContain("invisible");
    act(() => {
      notify(url.origin, fixtures.id);
    });
    await waitFor(() => expect(frame.className).not.toContain("invisible"));
    fireEvent.click(screen.getByRole("button", { name: "Local" }));
    expect(screen.getByTitle("Mini workspace")).toBe(frame);
    expect(frame.closest("section")?.hidden).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Remote" }));
    await waitFor(() => expect(frame.closest("section")?.hidden).toBe(false));
    expect(screen.getByTitle("Mini workspace")).toBe(frame);
  });
});
