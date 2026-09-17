// @vitest-environment jsdom
import { cleanup, fireEvent, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadPluginApp, renderSlot } from "@get-kaioken/plugin-sdk/testing/app";
import {
  CONNECT_LOGIN_CHANNEL,
  type ConnectLoginStatus,
} from "@kaioken/connect-client";
import { CONNECT_REALTIME_CHANNEL, type ConnectStatus } from "@/src/types";

const app = await loadPluginApp(() => import("./app"));

beforeEach(() => {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
});

afterEach(cleanup);

function status(overrides: Partial<ConnectStatus> = {}): ConnectStatus {
  return {
    state: "disconnected",
    paired: false,
    handle: null,
    url: null,
    dashboardUrl: "https://kaioken.app/dashboard",
    lastError: null,
    nextRetryAt: null,
    since: 1_700_000_000_000,
    remoteClients: 0,
    lastRemoteActivityAt: null,
    shares: [],
    ...overrides,
  };
}

const connected = (overrides: Partial<ConnectStatus> = {}) =>
  status({
    state: "connected",
    paired: true,
    handle: "workstation",
    url: "https://workstation.kaioken.app",
    since: 1_700_000_060_000,
    ...overrides,
  });

describe("connect settings section", () => {
  it("uses the plugin page header instead of declaring a second title", () => {
    expect(app.settingsSections[0]?.title).toBeUndefined();
  });

  it("shows a remote-viewer count on the connected status line", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      { rpc: { status: () => connected({ remoteClients: 2 }) } },
    );
    await slot.findByText("Connected");
    await slot.findByText(/2 viewing remotely/);
  });

  it("reconnecting shows the amber state with the human transport error", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            connected({
              state: "reconnecting",
              lastError: "can't reach kaioken.app — connection refused",
              nextRetryAt: null,
            }),
        },
      },
    );
    await slot.findByText("Reconnecting…");
    await slot.findByText(/can't reach kaioken.app — connection refused/);
    await slot.findByText(/Local access is unaffected/);
    expect(slot.queryByRole("button", { name: "Open" })).toBeNull();
  });

  it("revokes a shared port", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            connected({
              shares: [
                {
                  hostId: "host-server",
                  hostName: "Workstation",
                  port: 3000,
                  createdAt: 1,
                  url: "https://workstation--3000.kaioken.app",
                },
              ],
            }),
          unexpose: () => ({ removed: true, port: 3000 }),
        },
      },
    );

    await slot.findByText(":3000");
    fireEvent.click(slot.getByRole("button", { name: "Revoke" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { hostId: "host-server", port: 3000 },
      }),
    );
  });

  it("renders an unavailable share reason and keeps it revocable", async () => {
    const reason = "This host is not connected right now.";
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            connected({
              shares: [
                {
                  hostId: "host-air",
                  hostName: "Sawyer Air",
                  port: 3000,
                  createdAt: 1,
                  url: "",
                  unavailableReason: reason,
                },
              ],
            }),
          unexpose: () => ({ removed: true, port: 3000 }),
        },
      },
    );

    await slot.findByText(`Unavailable — ${reason}`);
    expect(
      slot.queryByRole("button", { name: "Copy share URL for port 3000" }),
    ).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Revoke" }));
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { hostId: "host-air", port: 3000 },
      }),
    );
  });

  it("groups shares by host and degrades an unreachable host's group", async () => {
    const reason = "sawyer-air is not connected right now.";
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () =>
            connected({
              shares: [
                {
                  hostId: "host-air",
                  hostName: "Sawyer Air",
                  port: 5173,
                  createdAt: 1,
                  url: "",
                  unavailableReason: reason,
                },
                {
                  hostId: "host-server",
                  hostName: "Workstation",
                  port: 3000,
                  createdAt: 2,
                  url: "https://workstation--3000.kaioken.app",
                },
                {
                  hostId: "host-server",
                  hostName: "Workstation",
                  port: 8080,
                  createdAt: 3,
                  url: "https://workstation--8080.kaioken.app",
                },
              ],
            }),
          unexpose: () => ({ removed: true, port: 5173 }),
        },
      },
    );

    await slot.findByText("Sawyer Air");
    expect(slot.getAllByText("Workstation")).toHaveLength(1);

    expect(
      slot
        .getByText("workstation--3000.kaioken.app")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe("https://workstation--3000.kaioken.app");
    slot.getByText(`Unavailable — ${reason}`);
    expect(
      slot.queryByRole("button", { name: "Copy share URL for port 5173" }),
    ).toBeNull();

    const revokeButtons = slot.getAllByRole("button", { name: "Revoke" });
    expect(revokeButtons).toHaveLength(3);
    fireEvent.click(revokeButtons[0]!);
    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "unexpose",
        input: { hostId: "host-air", port: 5173 },
      }),
    );
  });

  it("exposes a port through the disclosure form and surfaces errors", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => connected({ shares: [] }),
          expose: () => {
            throw new Error("this kaioken is not connected to kaioken.app");
          },
        },
      },
    );

    await slot.findByText("Shared ports");
    expect(slot.queryByLabelText("Port to share")).toBeNull();
    fireEvent.click(slot.getByRole("button", { name: "Expose a port" }));

    fireEvent.change(slot.getByLabelText("Port to share"), {
      target: { value: "8080" },
    });
    fireEvent.click(slot.getByRole("button", { name: "Expose" }));

    await waitFor(() =>
      expect(slot.rpcCalls).toContainEqual({
        method: "expose",
        input: { port: 8080 },
      }),
    );
    await slot.findByText(/this kaioken is not connected to kaioken.app/);
  });

  it("keeps credentials when revoking this computer fails", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => connected(),
          revokeDevice: () => {
            throw new Error("Relay unavailable");
          },
        },
      },
    );
    await slot.findByText("Connected");
    fireEvent.click(slot.getByRole("button", { name: "Sign out" }));
    await slot.findByText("Sign out of this computer?");
    fireEvent.click(slot.getByRole("button", { name: "Sign out" }));
    await slot.findByText("Relay unavailable");
    expect(slot.rpcCalls.some((call) => call.method === "disconnect")).toBe(
      false,
    );
  });

  it("sign out revokes this computer and returns to GitHub sign-in", async () => {
    let currentStatus = connected();
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => currentStatus,
          revokeDevice: () => ({ ok: true }),
          disconnect: () => {
            currentStatus = status();
            return currentStatus;
          },
        },
      },
    );

    await slot.findByText("Connected");
    fireEvent.click(slot.getByRole("button", { name: "Sign out" }));

    await slot.findByText("Sign out of this computer?");
    await slot.findByText(/stop being available on your other computers/);
    fireEvent.click(slot.getByRole("button", { name: "Sign out" }));

    await waitFor(() =>
      expect(slot.rpcCalls.some((call) => call.method === "disconnect")).toBe(
        true,
      ),
    );
    await slot.emitRealtime(CONNECT_REALTIME_CHANNEL, currentStatus);

    await slot.findByRole("button", { name: "Continue with GitHub" });
    await slot.findByText("Signed out of this computer");
    expect(slot.rpcCalls).toContainEqual({
      method: "revokeDevice",
      input: { handle: "workstation" },
    });
    expect(slot.queryByText("Re-pair")).toBeNull();
    expect(slot.queryByText("Connect with a pairing code")).toBeNull();
  });
});

describe("GitHub sign-in", () => {
  const idle: ConnectLoginStatus = {
    state: "idle",
    browserUrl: null,
    expiresAt: null,
    error: null,
    account: null,
  };
  const waiting: ConnectLoginStatus = {
    ...idle,
    state: "waiting",
    browserUrl: "https://kaioken.app/auth/github?login=test",
    expiresAt: Date.now() + 600_000,
  };

  it("opens the browser once and receives completion without approval polling", async () => {
    const openUrl = vi.fn(() => true);
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        openUrl,
        rpc: {
          status: () => status(),
          signInStatus: () => idle,
          beginSignIn: () => waiting,
        },
      },
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Continue with GitHub" }),
    );
    await slot.findByText(/Finish signing in in your browser/);
    expect(openUrl).toHaveBeenCalledExactlyOnceWith(waiting.browserUrl);
    expect(
      slot.rpcCalls.filter((call) => call.method === "beginSignIn"),
    ).toEqual([{ method: "beginSignIn", input: {} }]);
    await slot.emitRealtime(CONNECT_LOGIN_CHANNEL, {
      ...idle,
      state: "signed-in",
      account: { githubId: "42", login: "owner" },
    });
    await slot.findByText("owner");
    expect(slot.queryByText(/Finish signing in/)).toBeNull();
    expect(
      slot.rpcCalls.filter((call) => call.method === "signInStatus"),
    ).toHaveLength(1);
  });

  it("resumes an existing browser link and cancels without starting another login", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => status(),
          signInStatus: () => waiting,
          cancelSignIn: () => idle,
        },
      },
    );
    expect(
      (await slot.findByRole("link", { name: "Open sign-in" })).getAttribute(
        "href",
      ),
    ).toBe(waiting.browserUrl);
    fireEvent.click(slot.getByRole("button", { name: "Cancel" }));
    await slot.findByRole("button", { name: "Continue with GitHub" });
    expect(
      slot.rpcCalls.filter((call) => call.method === "cancelSignIn"),
    ).toHaveLength(1);
    expect(slot.rpcCalls.some((call) => call.method === "beginSignIn")).toBe(
      false,
    );
  });

  it("shows a service configuration error and permits retry", async () => {
    const slot = renderSlot(
      app.settingsSections[0]!,
      {},
      {
        rpc: {
          status: () => status(),
          signInStatus: () => idle,
          beginSignIn: () => {
            throw new Error(
              "GitHub sign-in is not configured on this relay yet.",
            );
          },
        },
      },
    );
    fireEvent.click(
      await slot.findByRole("button", { name: "Continue with GitHub" }),
    );
    expect((await slot.findByRole("alert")).textContent).toContain(
      "not configured",
    );
    expect(
      slot
        .getByRole("button", { name: "Continue with GitHub" })
        .hasAttribute("disabled"),
    ).toBe(false);
  });
});
