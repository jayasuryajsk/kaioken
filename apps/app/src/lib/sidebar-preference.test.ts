// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@kaioken/domain";
import {
  applySidebarPreferences,
  compareByAttentionThen,
  DEFAULT_SIDEBAR_PREFERENCES,
  parseSidebarPreferences,
  selectRecentThreads,
  sidebarAttentionRank,
} from "./sidebar-preference";

function thread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return {
    id: "thr_1",
    status: "idle",
    hasPendingInteraction: false,
    queuedWork: "none",
    lastReadAt: 10,
    latestAttentionAt: 5,
    updatedAt: 5,
    archivedAt: null,
    visibility: "visible",
    ...overrides,
  } as ThreadListEntry;
}

describe("sidebar preferences", () => {
  it("falls back to defaults for malformed or partial storage", () => {
    expect(parseSidebarPreferences(null)).toEqual(DEFAULT_SIDEBAR_PREFERENCES);
    expect(parseSidebarPreferences("nope")).toEqual(
      DEFAULT_SIDEBAR_PREFERENCES,
    );
    expect(parseSidebarPreferences('{"density":"compact"}')).toEqual({
      ...DEFAULT_SIDEBAR_PREFERENCES,
      density: "compact",
    });
    expect(parseSidebarPreferences('{"recentCount":4}')).toEqual(
      DEFAULT_SIDEBAR_PREFERENCES,
    );
  });

  it("migrates every old threadList value onto the unified layout", () => {
    expect(parseSidebarPreferences('{"threadList":"projects"}').layout).toBe(
      "unified",
    );
    expect(parseSidebarPreferences('{"threadList":"timeline"}').layout).toBe(
      "unified",
    );
    expect(parseSidebarPreferences('{"layout":"projects"}').layout).toBe(
      "projects",
    );
    expect(parseSidebarPreferences('{"threadList":"bogus"}').layout).toBe(
      "unified",
    );
    expect(
      parseSidebarPreferences('{"threadList":"projects","layout":"unified"}')
        .layout,
    ).toBe("unified");
  });

  it("mirrors preferences onto html data attributes and clears them", () => {
    const root = document.createElement("html");
    applySidebarPreferences(
      {
        ...DEFAULT_SIDEBAR_PREFERENCES,
        density: "compact",
        headingLabels: true,
      },
      root,
    );
    expect(root.getAttribute("data-sidebar-density")).toBe("compact");
    expect(root.hasAttribute("data-sidebar-heading-labels")).toBe(true);
    applySidebarPreferences(DEFAULT_SIDEBAR_PREFERENCES, root);
    expect(root.getAttribute("data-sidebar-density")).toBe("default");
    expect(root.hasAttribute("data-sidebar-heading-labels")).toBe(false);
  });

  it("ranks waiting threads before failed ones before everything else", () => {
    expect(sidebarAttentionRank(thread({ hasPendingInteraction: true }))).toBe(
      0,
    );
    expect(sidebarAttentionRank(thread({ queuedWork: "failed" }))).toBe(1);
    expect(
      sidebarAttentionRank(
        thread({ status: "error", lastReadAt: 1, latestAttentionAt: 5 }),
      ),
    ).toBe(1);
    expect(sidebarAttentionRank(thread({}))).toBe(2);
  });

  it("sorts by attention first and keeps the base comparator's extras", () => {
    const base = Object.assign(
      (left: ThreadListEntry, right: ThreadListEntry) =>
        right.updatedAt - left.updatedAt,
      { compareItems: () => 0 },
    );
    const compare = compareByAttentionThen(base);
    const newest = thread({ id: "a", updatedAt: 9 });
    const waiting = thread({
      id: "b",
      updatedAt: 1,
      hasPendingInteraction: true,
    });
    expect([newest, waiting].sort(compare).map((entry) => entry.id)).toEqual([
      "b",
      "a",
    ]);
    expect(compare.compareItems).toBe(base.compareItems);
  });

  it("selects the most recently updated visible, unarchived threads", () => {
    const threads = [
      thread({ id: "old", updatedAt: 1 }),
      thread({ id: "hidden", updatedAt: 9, visibility: "hidden" }),
      thread({ id: "archived", updatedAt: 8, archivedAt: 8 }),
      thread({ id: "new", updatedAt: 7 }),
      thread({ id: "mid", updatedAt: 4 }),
    ];
    expect(selectRecentThreads(threads, 2).map((entry) => entry.id)).toEqual([
      "new",
      "mid",
    ]);
    expect(selectRecentThreads(threads, 0)).toEqual([]);
  });
});
