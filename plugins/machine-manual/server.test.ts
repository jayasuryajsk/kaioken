import { createFakePluginHost } from "@get-bb/plugin-sdk/testing";
import type { EnrollmentBootstrap } from "@get-bb/plugin-sdk";
import { expect, it, vi } from "vitest";
import plugin from "./server.js";

it("serves the prepared command from memory, expires without renewing, and clears on completion", async () => {
  const { bb, harness } = createFakePluginHost();
  const bootstrap: EnrollmentBootstrap = {
    hostId: "host",
    serverUrl: "https://bb.example.com",
    credential: "test-code",
    expiresAt: Date.now() + 60000,
  };
  const prepare = vi.fn(async () => ({
    id: "enrollment",
    hostId: "host",
    state: "pending" as const,
    bootstrap,
    expiresAt: bootstrap.expiresAt,
  }));
  let finish!: (value: { hostId: string }) => void;
  bb.experimental_machines.enrollments.prepare = prepare;
  bb.experimental_machines.enrollments.waitForConnection = () =>
    new Promise((resolve) => {
      finish = resolve;
    });
  plugin(bb);
  const provider = harness.registrations.machineProviders.get("manual");
  if (!provider) throw new Error("Missing provider");
  const creating = provider.create({
    key: "launch",
    attempt: 1,
    inputs: null,
    checkpoint: async () => {},
    report: { step() {}, log() {} },
    signal: new AbortController().signal,
  });
  await vi.waitFor(() => expect(finish).toBeDefined());
  const read = () => harness.callRpc("command", { launchId: "launch" });
  expect(await read()).toEqual({
    command:
      "curl -fsSL -H 'X-BB-Enrollment: test-code' 'https://bb.example.com/install.sh' | sh",
    expiresAt: bootstrap.expiresAt,
  });
  expect(await harness.callRpc("command", { launchId: "other" })).toEqual({
    command: null,
    expiresAt: null,
  });
  const clock = vi.spyOn(Date, "now").mockReturnValue(bootstrap.expiresAt + 1);
  try {
    expect(await read()).toEqual({
      command: null,
      expiresAt: bootstrap.expiresAt,
    });
    expect(await read()).toEqual({ command: null, expiresAt: null });
  } finally {
    clock.mockRestore();
  }
  expect(prepare).toHaveBeenCalledTimes(1);
  finish({ hostId: "host" });
  await creating;
  expect(await read()).toEqual({ command: null, expiresAt: null });
  await harness.lifecycle.dispose();
});

it("forgets the command when creation is cancelled", async () => {
  const { bb, harness } = createFakePluginHost();
  const bootstrap: EnrollmentBootstrap = {
    hostId: "host",
    serverUrl: "https://bb.example.com",
    credential: "test-code",
    expiresAt: Date.now() + 60000,
  };
  bb.experimental_machines.enrollments.prepare = async () => ({
    id: "enrollment",
    hostId: "host",
    state: "pending",
    bootstrap,
    expiresAt: bootstrap.expiresAt,
  });
  bb.experimental_machines.enrollments.waitForConnection = ({ signal }) =>
    new Promise((_, reject) =>
      signal.addEventListener("abort", () => reject(signal.reason), {
        once: true,
      }),
    );
  plugin(bb);
  const provider = harness.registrations.machineProviders.get("manual");
  if (!provider) throw new Error("Missing provider");
  const controller = new AbortController();
  const creating = provider.create({
    key: "launch",
    attempt: 1,
    inputs: null,
    checkpoint: async () => {},
    report: { step() {}, log() {} },
    signal: controller.signal,
  });
  const rejected = expect(creating).rejects.toThrow("cancelled");
  await vi.waitFor(async () =>
    expect(
      await harness.callRpc("command", { launchId: "launch" }),
    ).toMatchObject({ command: expect.any(String) }),
  );
  controller.abort(new Error("cancelled"));
  await rejected;
  expect(await harness.callRpc("command", { launchId: "launch" })).toEqual({
    command: null,
    expiresAt: null,
  });
  await harness.lifecycle.dispose();
});
