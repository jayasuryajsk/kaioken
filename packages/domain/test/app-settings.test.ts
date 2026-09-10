import { describe, expect, it } from "vitest";
import {
  appSettingsSchema,
  defaultAppSettings,
  managedBranchPrefixSchema,
  MANAGED_BRANCH_PREFIX_MAX_LENGTH,
} from "../src/app-settings.js";

describe("managedBranchPrefixSchema", () => {
  it("accepts prefixes that start a valid branch name", () => {
    for (const prefix of ["kaioken/", "", "sawyer/wt-", "team/kaioken/", "wip_"]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(true);
    }
  });

  it("rejects prefixes that cannot start a valid branch name", () => {
    for (const prefix of [
      " kaioken/",
      "kaioken //",
      "-kaioken/",
      "/kaioken/",
      "kaioken//",
      "kaioken../",
      "bb:",
      "kaioken~",
      "kaioken\\",
      "kaioken@{",
      ".kaioken/",
      "a".repeat(MANAGED_BRANCH_PREFIX_MAX_LENGTH + 1),
    ]) {
      expect(managedBranchPrefixSchema.safeParse(prefix).success).toBe(false);
    }
  });

  it("defaults to the kaioken namespace", () => {
    expect(defaultAppSettings.managedBranchPrefix).toBe("kaioken/");
    expect(appSettingsSchema.parse(defaultAppSettings)).toEqual(
      defaultAppSettings,
    );
  });
});
