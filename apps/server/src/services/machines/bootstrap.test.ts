import { describe, expect, it, vi } from "vitest";
import type {
  MachineExecutor,
  MachineEnrollments,
  EnrollmentBootstrap,
} from "@get-bb/plugin-sdk";
import { createMachineBootstrapApi } from "./bootstrap.js";

const bootstrap: EnrollmentBootstrap = {
  hostId: "host_1",
  serverUrl: "https://server.example",
  credential: "private-credential",
  expiresAt: Date.now() + 60_000,
};

function harness() {
  const enrollments: MachineEnrollments = {
    prepare: vi.fn<MachineEnrollments["prepare"]>(async () => ({
      id: "enrollment",
      hostId: "host_1",
      state: "pending",
      bootstrap,
    })),
    waitForConnection: vi.fn(async () => ({ hostId: "host_1" })),
  };
  const api = createMachineBootstrapApi(enrollments);
  const exec = vi.fn<MachineExecutor["exec"]>(async () => ({
    exitCode: 0,
    stdout: "",
    stderr: "",
  }));
  const report = { step: vi.fn(), log: vi.fn() };
  return { api, enrollments, exec, report };
}

describe("machine bootstrap", () => {
  it("delivers credentials only through stdin and never reports executor output", async () => {
    const h = harness();
    h.exec.mockResolvedValue({
      exitCode: 0,
      stdout: bootstrap.credential,
      stderr: bootstrap.credential,
    });
    const result = await h.api.bootstrap({
      key: "key",
      executor: { exec: h.exec },
      report: h.report,
      signal: new AbortController().signal,
    });
    const request = vi.mocked(h.exec).mock.calls[0];
    expect(JSON.stringify(request)).toContain(bootstrap.credential);
    expect(JSON.stringify(h.report.step.mock.calls)).not.toContain(
      bootstrap.credential,
    );
    expect(h.report.log).not.toHaveBeenCalled();
    expect(h.enrollments.waitForConnection).toHaveBeenCalledOnce();
    expect(result).toBeUndefined();
    expect(request[0].command.join(" ")).not.toContain(bootstrap.credential);
  });

  it("redacts transport failures and retains enrollment for retry", async () => {
    const h = harness();
    h.exec.mockRejectedValue(new Error(bootstrap.credential));
    await expect(
      h.api.bootstrap({
        key: "key",
        executor: { exec: h.exec },
        report: h.report,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/^Machine bootstrap command failed$/);
    expect(h.enrollments.waitForConnection).not.toHaveBeenCalled();
  });

  it("starts an already enrolled machine before waiting after snapshot restore", async () => {
    const h = harness();
    vi.mocked(h.enrollments.prepare).mockResolvedValue({
      id: "enrollment",
      hostId: "host_1",
      state: "enrolled",
    });
    await h.api.bootstrap({
      key: "key",
      executor: { exec: h.exec },
      report: h.report,
      signal: new AbortController().signal,
    });
    expect(h.exec).toHaveBeenCalledWith(
      expect.objectContaining({
        command: ["sh", "-s", "--", "--start", "--host-id", "host_1"],
        stdin: expect.stringContaining("Usage: install.sh"),
      }),
    );
    expect(h.enrollments.waitForConnection).toHaveBeenCalledOnce();
  });

  it("does no work after abort", async () => {
    const h = harness();
    await expect(
      h.api.bootstrap({
        key: "key",
        executor: { exec: h.exec },
        report: h.report,
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    expect(h.enrollments.prepare).not.toHaveBeenCalled();
    expect(h.exec).not.toHaveBeenCalled();
  });
});
