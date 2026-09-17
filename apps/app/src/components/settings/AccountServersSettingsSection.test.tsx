// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { AccountServersSettingsSection } from "./AccountServersSettingsSection";

const mocks = vi.hoisted(() => ({ callRpc: vi.fn(), refetch: vi.fn() }));
vi.mock("@/lib/sdk", () => ({ sdk: { plugins: { callRpc: mocks.callRpc } } }));
vi.mock("@/components/sidebar/TimelineThreadList", () => ({ useNow: () => 0 }));
vi.mock("@/hooks/queries/federation-queries", () => ({
  useAccountServers: () => ({
    data: [
      {
        handle: "macbook",
        name: "MacBook",
        live: true,
        lastSeenAt: null,
        home: false,
        url: "https://macbook.kaioken.app",
      },
    ],
    isPending: false,
    refetch: mocks.refetch,
  }),
}));
beforeEach(() => {
  mocks.callRpc.mockReset().mockResolvedValue({ ok: true });
  mocks.refetch.mockReset();
});
afterEach(cleanup);

it("renames a selected computer and refreshes its directory", async () => {
  const view = render(
    <MemoryRouter>
      <AccountServersSettingsSection />
    </MemoryRouter>,
  );
  fireEvent.click(view.getByRole("button", { name: "Rename MacBook" }));
  fireEvent.change(view.getByLabelText("Name for MacBook"), {
    target: { value: "  Work laptop  " },
  });
  fireEvent.click(view.getByRole("button", { name: "Save" }));
  await waitFor(() =>
    expect(mocks.callRpc).toHaveBeenCalledWith(
      expect.objectContaining({
        pluginId: "connect",
        method: "renameDevice",
        input: { handle: "macbook", name: "Work laptop" },
      }),
    ),
  );
  await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
});

it("requires confirmation for revoke and retains a failed action for retry", async () => {
  const view = render(
    <MemoryRouter>
      <AccountServersSettingsSection />
    </MemoryRouter>,
  );
  fireEvent.click(view.getByRole("button", { name: "Revoke MacBook" }));
  expect(mocks.callRpc).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Cancel" }));
  expect(mocks.callRpc).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Revoke MacBook" }));
  mocks.callRpc.mockRejectedValueOnce(new Error("Could not reach relay"));
  fireEvent.click(view.getByRole("button", { name: "Revoke access" }));
  expect((await view.findByRole("alert")).textContent).toBe(
    "Could not reach relay",
  );
  expect(mocks.refetch).not.toHaveBeenCalled();
  fireEvent.click(view.getByRole("button", { name: "Revoke access" }));
  await waitFor(() => expect(mocks.refetch).toHaveBeenCalledOnce());
  expect(mocks.callRpc).toHaveBeenLastCalledWith(
    expect.objectContaining({
      method: "revokeDevice",
      input: { handle: "macbook" },
    }),
  );
});
