import { describe, expect, it } from "vitest";
import { formatHomePathForDisplay } from "@kaioken/shared-ui/lib/utils";

describe("formatHomePathForDisplay", () => {
  it.each([
    ["/Users/you", "~"],
    ["/Users/you/.kaioken/plugins/github", "~/.kaioken/plugins/github"],
    ["/home/u/.kaioken/skills/review", "~/.kaioken/skills/review"],
    ["/root/.kaioken/automations/run.sh", "~/.kaioken/automations/run.sh"],
    ["C:\\Users\\you\\.kaioken\\plugins", "~\\.kaioken\\plugins"],
  ])("compacts a conventional home path %s", (path, expected) => {
    expect(formatHomePathForDisplay(path)).toBe(expected);
  });

  it.each([
    "/managed/plugins/github",
    "/Volumes/work/plugins/github",
    "skills.sh/example/writing-voice",
    "SKILL.md",
  ])("preserves a path outside a conventional home %s", (path) => {
    expect(formatHomePathForDisplay(path)).toBe(path);
  });
});
