// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { Dialog, DialogContent } from "@bb/shared-ui/dialog";
import { ManualMachineSetup } from "./AddMachineDialog";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    hosts: {
      experimental_cancel: vi.fn(),
      experimental_follow: vi.fn(),
      experimental_submit: vi.fn(),
    },
  },
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("cancels a creating manual launch when the dialog content closes", async () => {
  vi.mocked(sdk.hosts.experimental_submit).mockResolvedValue({
    id: "manual-launch",
    command: "bb machine enroll test",
    commandExpiresAt: Date.now() + 60_000,
    phase: "creating",
    hostId: "host-reserved",
    step: "Waiting for the machine",
    log: "",
    message: null,
    cancelPending: false,
    terminal: false,
  });
  vi.mocked(sdk.hosts.experimental_follow).mockImplementation(
    () => new Promise(() => {}),
  );
  vi.mocked(sdk.hosts.experimental_cancel).mockResolvedValue({
    id: "manual-launch",
    command: null,
    commandExpiresAt: null,
    phase: "cancelled",
    hostId: "host-reserved",
    step: "Cancelled",
    log: "",
    message: null,
    cancelPending: false,
    terminal: true,
  });
  const { wrapper } = createQueryClientTestHarness();
  const rendered = render(
    <Dialog open modal={false}>
      <DialogContent>
        <ManualMachineSetup onOpenChange={() => {}} />
      </DialogContent>
    </Dialog>,
    { wrapper },
  );

  await screen.findByText("bb machine enroll test");
  rendered.unmount();

  await waitFor(() => {
    expect(sdk.hosts.experimental_cancel).toHaveBeenCalledWith({
      id: "manual-launch",
    });
  });
});
