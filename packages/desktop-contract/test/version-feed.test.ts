import { describe, expect, it } from "vitest";
import {
  kaiokenDesktopInfoSchema,
  kaiokenDesktopThemeSchema,
  kaiokenDesktopVersionFeedSchema,
  kaiokenDesktopWindowStateSchema,
  createBbDesktopVersionFeedFileName,
} from "../src/index.js";

const checkedAt = "2026-05-21T00:00:00.000Z";

describe("desktop info schema", () => {
  it("accepts the desktop update info payload", () => {
    expect(
      kaiokenDesktopInfoSchema.safeParse({
        lastCheckedAt: checkedAt,
        latestVersion: "0.0.2",
        pendingVersion: null,
        platform: "macos",
        updateAvailable: true,
        updateDownloaded: false,
        version: "0.0.1",
      }).success,
    ).toBe(true);
  });

  it("accepts the desktop theme values", () => {
    expect(kaiokenDesktopThemeSchema.safeParse("dark").success).toBe(true);
    expect(kaiokenDesktopThemeSchema.safeParse("light").success).toBe(true);
    expect(kaiokenDesktopThemeSchema.safeParse("system").success).toBe(true);
    expect(
      kaiokenDesktopThemeSchema.safeParse({
        canvasColor: "oklch(0.195 0 0)",
        inkColor: "oklch(0.81 0 0)",
        mode: "dark",
      }).success,
    ).toBe(false);
  });

  it("accepts strict desktop window state payloads", () => {
    expect(
      kaiokenDesktopWindowStateSchema.safeParse({ isFullScreen: true }).success,
    ).toBe(true);
    expect(
      kaiokenDesktopWindowStateSchema.safeParse({
        isFullScreen: true,
        extra: true,
      }).success,
    ).toBe(false);
  });
});

describe("desktop version feed schema", () => {
  it("accepts a valid desktop-version.json payload", () => {
    expect(
      kaiokenDesktopVersionFeedSchema.safeParse({
        channel: "latest",
        files: [
          {
            sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
            size: 123456789,
            url: "kaioken-0.0.2-universal.zip",
          },
        ],
        minimumSystemVersion: null,
        path: "kaioken-0.0.2-universal.zip",
        platform: "macos",
        releaseDate: checkedAt,
        releaseName: "kaioken desktop 0.0.2",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2",
      }).success,
    ).toBe(true);
  });

  it("accepts the isolated nightly desktop channel", () => {
    expect(
      kaiokenDesktopVersionFeedSchema.safeParse({
        channel: "nightly",
        files: [
          {
            sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
            size: 123456789,
            url: "kaioken-nightly-0.0.2-nightly.1.1-arm64.zip",
          },
        ],
        minimumSystemVersion: null,
        path: "kaioken-nightly-0.0.2-nightly.1.1-arm64.zip",
        platform: "macos",
        releaseDate: checkedAt,
        releaseName: "kaioken Nightly desktop 0.0.2-nightly.1.1",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2-nightly.1.1",
      }).success,
    ).toBe(true);
  });

  it("accepts a Linux AppImage version feed payload", () => {
    expect(
      kaiokenDesktopVersionFeedSchema.safeParse({
        channel: "latest",
        files: [
          {
            sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
            size: 123456789,
            url: "kaioken-0.0.2-x86_64.AppImage",
          },
        ],
        minimumSystemVersion: null,
        path: "kaioken-0.0.2-x86_64.AppImage",
        platform: "linux",
        releaseDate: checkedAt,
        releaseName: "kaioken desktop 0.0.2",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2",
      }).success,
    ).toBe(true);
  });

  it("keeps the macOS feed file name unsuffixed so shipped builds keep updating", () => {
    expect(createBbDesktopVersionFeedFileName("macos")).toBe(
      "desktop-version.json",
    );
    expect(createBbDesktopVersionFeedFileName("linux")).toBe(
      "desktop-version-linux.json",
    );
  });

  it("rejects malformed version feed payloads", () => {
    expect(
      kaiokenDesktopVersionFeedSchema.safeParse({
        channel: "latest",
        files: [],
        minimumSystemVersion: null,
        path: "kaioken-0.0.2-universal.zip",
        platform: "macos",
        releaseDate: checkedAt,
        releaseName: "kaioken desktop 0.0.2",
        releaseNotes: null,
        schemaVersion: 1,
        sha512: "BASE64_SHA512_FROM_ELECTRON_BUILDER",
        stagingPercentage: null,
        version: "0.0.2",
      }).success,
    ).toBe(false);
  });
});
