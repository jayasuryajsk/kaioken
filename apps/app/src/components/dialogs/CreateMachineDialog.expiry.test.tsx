// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MachineLaunchCommand } from "./CreateMachineDialog";

const COMMAND = "curl -fsSL -H 'X-BB-Enrollment: secret' https://bb/install.sh | sh";

describe("MachineLaunchCommand", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("counts the remaining time down while the command is still valid", () => {
    render(
      <MachineLaunchCommand
        command={COMMAND}
        expiresAt={15 * 60_000}
        onRegenerate={() => {}}
      />,
    );
    expect(screen.getByRole("status").textContent).toBe("Expires in 15m 00s.");
    act(() => void vi.advanceTimersByTime(61_000));
    expect(screen.getByRole("status").textContent).toBe("Expires in 13m 59s.");
    expect(screen.getByText(COMMAND)).toBeTruthy();
  });

  it("withdraws the stale command and offers a replacement once it expires", () => {
    const onRegenerate = vi.fn();
    render(
      <MachineLaunchCommand
        command={COMMAND}
        expiresAt={5_000}
        onRegenerate={onRegenerate}
      />,
    );
    expect(screen.queryByText(COMMAND)).not.toBeNull();
    act(() => void vi.advanceTimersByTime(6_000));
    expect(screen.getByRole("status").textContent).toBe(
      "This command has expired.",
    );
    expect(screen.queryByText(COMMAND)).toBeNull();
    expect(screen.queryByRole("button", { name: "Copy command" })).toBeNull();
    screen.getByRole("button", { name: "Generate new command" }).click();
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});
