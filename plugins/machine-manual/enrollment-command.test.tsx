// @vitest-environment jsdom

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
const readCommand =
  vi.fn<() => Promise<{ command: string | null; expiresAt: number | null }>>();
vi.mock("@get-bb/plugin-sdk/app", () => ({ useRpc: vi.fn() }));
import { ManualEnrollmentCommandView as ManualEnrollmentCommand } from "./enrollment-command.js";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("discards the private command when the server settles enrollment", async () => {
  readCommand
    .mockResolvedValueOnce({
      command: "bb machine enroll --bootstrap-env PRIVATE_BUNDLE",
      expiresAt: Date.now() + 60_000,
    })
    .mockResolvedValue({ command: null, expiresAt: null });
  render(
    <ManualEnrollmentCommand
      readCommand={readCommand}
      launchId="manual-launch"
    />,
  );
  expect(
    await screen.findByText("bb machine enroll --bootstrap-env PRIVATE_BUNDLE"),
  ).toBeTruthy();
  await waitFor(
    () =>
      expect(
        screen.queryByText("bb machine enroll --bootstrap-env PRIVATE_BUNDLE"),
      ).toBeNull(),
    { timeout: 3000 },
  );
  expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
});

it("counts down, keeps the expired state after the command disappears, and lets regeneration retry", async () => {
  vi.useFakeTimers();
  try {
    const expiresAt = Date.now() + 2000;
    readCommand.mockResolvedValue({
      command: "private-command",
      expiresAt,
    });
    const regenerate = vi
      .fn()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValue(undefined);
    render(
      <ManualEnrollmentCommand
        readCommand={readCommand}
        launchId="expiring"
        onRegenerate={regenerate}
      />,
    );
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.getByText("Expires in 0:02")).toBeTruthy();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(screen.getByText("Code expired")).toBeTruthy();
    expect(screen.queryByText("private-command")).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
    readCommand.mockResolvedValue({
      command: null,
      expiresAt: null,
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1000);
    });
    expect(screen.getByText("Code expired")).toBeTruthy();
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Generate new command" }),
      );
    });
    expect(screen.getByRole("alert").textContent).toContain("Try again");
    await act(async () => {
      fireEvent.click(
        screen.getByRole("button", { name: "Generate new command" }),
      );
    });
    expect(regenerate).toHaveBeenCalledTimes(2);
  } finally {
    cleanup();
    vi.useRealTimers();
  }
});
