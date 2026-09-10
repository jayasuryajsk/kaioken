import { describe, expect, it, vi } from "vitest";
import {
  setupCommandOutputTestEnvironment,
  collectLogLines,
  runCommand,
} from "../helpers/command-output-harness.js";
import type { CommandRegistrar } from "../helpers/command-output-harness.js";
import { registerManagerCommands } from "../../commands/manager.js";

describe("kaioken manager command output", () => {
  setupCommandOutputTestEnvironment();

  const register: CommandRegistrar = (program) =>
    registerManagerCommands(program);

  it("kaioken manager exits with a parent-thread replacement message", async () => {
    await expect(runCommand(["manager"], register)).rejects.toThrow(
      "process.exit:1",
    );

    const error = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(error).toContain("Manager threads were replaced by parent threads.");
    expect(error).toContain("kaioken thread spawn --parent-thread <id>");
  });

  it("kaioken manager subcommands exit with the same replacement message", async () => {
    await expect(
      runCommand(["manager", "list", "project-123"], register),
    ).rejects.toThrow("process.exit:1");

    const error = collectLogLines(vi.mocked(console.error)).join("\n");
    expect(error).toContain("Manager threads were replaced by parent threads.");
    expect(error).toContain("kaioken thread list --parent-thread <id>");
  });
});
