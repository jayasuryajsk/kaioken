import { describe, expect, it } from "vitest";
import { kaiokenDesktopInfoSchema } from "../src/info.js";

const baseInfo = {
  lastCheckedAt: null,
  latestVersion: "0.0.32",
  pendingVersion: null,
  platform: "macos",
  updateAvailable: true,
  updateDownloaded: false,
  version: "0.0.31",
} as const;

describe("kaiokenDesktopInfoSchema", () => {
  it("accepts both explicit download state and legacy shell payloads", () => {
    expect(
      kaiokenDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "downloading",
      }).success,
    ).toBe(true);
    expect(kaiokenDesktopInfoSchema.safeParse(baseInfo).success).toBe(true);
  });

  it("rejects an unknown download state", () => {
    expect(
      kaiokenDesktopInfoSchema.safeParse({
        ...baseInfo,
        downloadState: "available",
      }).success,
    ).toBe(false);
  });

  it("accepts linux", () => {
    expect(
      kaiokenDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "linux",
      }).success,
    ).toBe(true);
  });

  it("rejects win32", () => {
    expect(
      kaiokenDesktopInfoSchema.safeParse({
        ...baseInfo,
        platform: "win32",
      }).success,
    ).toBe(false);
  });
});
