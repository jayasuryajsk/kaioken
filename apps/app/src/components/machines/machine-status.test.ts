import type { Host, MachineLifecycle } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  machinePhaseLabel,
  machineStatusLabel,
  machineStatusTone,
} from "./machine-status";

const NOW = Date.parse("2026-09-09T12:00:00Z");

function lifecycle(
  phase: MachineLifecycle["phase"],
  overrides: Partial<MachineLifecycle> = {},
): MachineLifecycle {
  return {
    phase,
    suspendedAt: null,
    retireAt: null,
    progress: null,
    teardown: null,
    ...overrides,
  };
}

function host(overrides: Partial<Host> = {}): Host {
  return makeHost({ createdAt: NOW, ...overrides });
}

describe("machinePhaseLabel", () => {
  it.each([
    ["active", null],
    ["destroyed", null],
    ["suspending", "Pausing"],
    ["suspended", "Paused"],
    ["retiring", "Retiring"],
  ] as const)("maps %s to %s", (phase, label) => {
    expect(machinePhaseLabel(lifecycle(phase))).toBe(label);
  });

  it("prioritizes cleanup failure over retiring", () => {
    expect(
      machinePhaseLabel(
        lifecycle("retiring", {
          teardown: { status: "failed", attempt: 1, message: "uninstall" },
        }),
      ),
    ).toBe("Cleanup failed");
  });
});

describe("machineStatusTone", () => {
  it.each(["retiring", "suspending"] as const)(
    "marks a %s machine for attention even while it is still connected",
    (phase) => {
      expect(machineStatusTone(host({ lifecycle: lifecycle(phase) }))).toBe(
        "attention",
      );
    },
  );

  it("marks a failed teardown as failed rather than merely retiring", () => {
    expect(
      machineStatusTone(
        host({
          status: "disconnected",
          lifecycle: lifecycle("retiring", {
            teardown: { status: "failed", attempt: 3 },
          }),
        }),
      ),
    ).toBe("failed");
  });

  it("follows the connection for every other phase", () => {
    expect(machineStatusTone(host())).toBe("online");
    expect(
      machineStatusTone(
        host({ status: "disconnected", lifecycle: lifecycle("suspended") }),
      ),
    ).toBe("offline");
  });
});

describe("machineStatusLabel", () => {
  it("replaces the connection word with the phase", () => {
    expect(
      machineStatusLabel({
        host: host({
          status: "disconnected",
          lastSeenAt: NOW - 60_000,
          lifecycle: lifecycle("suspended"),
        }),
        now: NOW,
      }),
    ).toBe("Paused · last seen 1m ago");
  });

  it("prefers provider progress over the last-seen suffix", () => {
    expect(
      machineStatusLabel({
        host: host({
          lastSeenAt: NOW - 60_000,
          lifecycle: lifecycle("suspending", {
            progress: "Saving the sandbox filesystem",
          }),
        }),
        now: NOW,
      }),
    ).toBe("Pausing · Saving the sandbox filesystem");
  });

  it("falls back to the connection for an ordinary machine", () => {
    expect(machineStatusLabel({ host: host(), now: NOW })).toBe("Online");
    expect(
      machineStatusLabel({
        host: host({ status: "disconnected", lastSeenAt: null }),
        now: NOW,
      }),
    ).toBe("Offline");
  });
});
