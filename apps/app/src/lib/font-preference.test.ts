// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  applyFontPreferences,
  DEFAULT_FONT_PREFERENCES,
  parseFontPreferences,
  previewFontPreference,
} from "./font-preference";

describe("font preferences", () => {
  it("falls back to defaults for missing, malformed, or partial storage", () => {
    expect(parseFontPreferences(null)).toEqual(DEFAULT_FONT_PREFERENCES);
    expect(parseFontPreferences("{not json")).toEqual(DEFAULT_FONT_PREFERENCES);
    expect(parseFontPreferences('{"headings":"georgia"}')).toEqual({
      ...DEFAULT_FONT_PREFERENCES,
      headings: "georgia",
    });
    expect(parseFontPreferences('{"headings":""}')).toEqual(
      DEFAULT_FONT_PREFERENCES,
    );
  });

  it("sets one custom property per aspect and clears inherited ones", () => {
    const root = document.createElement("html");
    applyFontPreferences(
      {
        ...DEFAULT_FONT_PREFERENCES,
        interface: "american-typewriter",
        headings: "georgia",
        code: "menlo",
      },
      root,
    );
    expect(root.style.getPropertyValue("--font-sans")).toContain(
      "American Typewriter",
    );
    expect(root.style.getPropertyValue("--font-heading")).toContain("Georgia");
    expect(root.style.getPropertyValue("--font-prose")).toBe("");
    expect(root.style.getPropertyValue("--font-mono")).toContain("Menlo");

    applyFontPreferences(DEFAULT_FONT_PREFERENCES, root);
    expect(root.style.getPropertyValue("--font-sans")).toBe("");
    expect(root.style.getPropertyValue("--font-heading")).toBe("");
    expect(root.style.getPropertyValue("--font-mono")).toBe("");
  });

  it("quotes a typed custom family and ignores a blank one", () => {
    const root = document.createElement("html");
    applyFontPreferences(
      {
        ...DEFAULT_FONT_PREFERENCES,
        conversation: "custom",
        custom: { conversation: "Iowan Old Style" },
      },
      root,
    );
    expect(root.style.getPropertyValue("--font-prose")).toBe(
      '"Iowan Old Style", sans-serif',
    );
    applyFontPreferences(
      { ...DEFAULT_FONT_PREFERENCES, conversation: "custom", custom: {} },
      root,
    );
    expect(root.style.getPropertyValue("--font-prose")).toBe("");
  });

  it("previews one aspect without touching the stored choice, then restores", () => {
    const stored = { ...DEFAULT_FONT_PREFERENCES, headings: "georgia" };
    previewFontPreference(stored, { aspect: "headings", optionId: "palatino" });
    expect(
      document.documentElement.style.getPropertyValue("--font-heading"),
    ).toContain("Palatino");
    previewFontPreference(stored, null);
    expect(
      document.documentElement.style.getPropertyValue("--font-heading"),
    ).toContain("Georgia");
  });
});
