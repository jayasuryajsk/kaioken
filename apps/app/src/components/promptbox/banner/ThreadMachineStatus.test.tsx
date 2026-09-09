// @vitest-environment jsdom

import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ThreadMachineStatus } from "./ThreadMachineStatus";

const state = vi.hoisted(() => ({
  phase: "suspended",
  provider: "modal-sandbox" as string | null,
  mutate: vi.fn(),
}));
vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({
    data: [
      {
        id: "host-test",
        name: "Sandbox",
        machineProviderId: state.provider,
        lifecycle: { phase: state.phase },
      },
    ],
  }),
}));
vi.mock("@/hooks/mutations/host-mutations", () => ({
  useResumeHost: () => ({
    mutate: state.mutate,
    isPending: false,
    error: null,
  }),
}));
afterEach(() => {
  cleanup();
  state.phase = "suspended";
  state.provider = "modal-sandbox";
  vi.clearAllMocks();
});

it("offers explicit resume for a paused provider machine", () => {
  render(<ThreadMachineStatus hostId="host-test" />);
  expect(screen.getByText("Sandbox is paused")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  expect(state.mutate).toHaveBeenCalledWith("host-test");
});

it("shows pause progress without offering a conflicting action", () => {
  state.phase = "suspending";
  render(<ThreadMachineStatus hostId="host-test" />);
  expect(screen.getByText("Pausing Sandbox…")).toBeTruthy();
  expect(screen.queryByRole("button", { name: "Resume" })).toBeNull();
});

it("does not offer resume for an ordinary disconnected host", () => {
  state.provider = null;
  const { container } = render(<ThreadMachineStatus hostId="host-test" />);
  expect(container.textContent).toBe("");
});
