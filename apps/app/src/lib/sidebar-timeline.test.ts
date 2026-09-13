import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@kaioken/domain";
import {
  buildPriorityList,
  buildTimelineGroups,
  buildTimelineSections,
  countNeedsYou,
  timelineGroupFor,
} from "./sidebar-timeline";

const NOON = new Date(2026, 8, 11, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function thread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return {
    id: "thr_1",
    parentThreadId: null,
    status: "idle",
    hasPendingInteraction: false,
    queuedWork: "none",
    runtime: { displayStatus: "idle" },
    activity: {
      activeWorkflowCount: 0,
      activeBackgroundAgentCount: 0,
      activeBackgroundCommandCount: 0,
      activePlanModeCount: 0,
      activeGoalCount: 0,
    },
    lastReadAt: NOON,
    latestAttentionAt: NOON - 1000,
    updatedAt: NOON - 1000,
    pinnedAt: null,
    archivedAt: null,
    visibility: "visible",
    ...overrides,
  } as ThreadListEntry;
}

describe("timeline grouping", () => {
  it("buckets by local day relative to now", () => {
    expect(timelineGroupFor(thread({ updatedAt: NOON - 60_000 }), NOON)).toBe(
      "today",
    );
    expect(timelineGroupFor(thread({ updatedAt: NOON - DAY }), NOON)).toBe(
      "yesterday",
    );
    expect(timelineGroupFor(thread({ updatedAt: NOON - 3 * DAY }), NOON)).toBe(
      "this-week",
    );
    expect(timelineGroupFor(thread({ updatedAt: NOON - 20 * DAY }), NOON)).toBe(
      "earlier",
    );
    expect(timelineGroupFor(thread({ pinnedAt: NOON }), NOON)).toBe("pinned");
  });

  it("emits only non-empty groups, newest first inside each", () => {
    const groups = buildTimelineGroups(
      [
        thread({ id: "a", updatedAt: NOON - 5000 }),
        thread({ id: "b", updatedAt: NOON - 1000 }),
        thread({ id: "old", updatedAt: NOON - 30 * DAY }),
        thread({ id: "archived", archivedAt: NOON }),
        thread({ id: "hidden", visibility: "hidden" }),
      ],
      NOON,
    );
    expect(groups.map((group) => group.id)).toEqual(["today", "earlier"]);
    expect(groups[0]?.threads.map((entry) => entry.id)).toEqual(["b", "a"]);
  });
});

describe("priority mode", () => {
  it("lists only threads needing you, longest wait first, then running ones", () => {
    const list = buildPriorityList([
      thread({ id: "idle", updatedAt: NOON }),
      thread({
        id: "running",
        runtime: { displayStatus: "active" } as ThreadListEntry["runtime"],
      }),
      thread({
        id: "waiting-short",
        hasPendingInteraction: true,
        latestAttentionAt: NOON - 1000,
      }),
      thread({
        id: "waiting-long",
        hasPendingInteraction: true,
        latestAttentionAt: NOON - 90_000,
      }),
      thread({
        id: "failed",
        queuedWork: "failed",
        latestAttentionAt: NOON - 50_000,
      }),
      thread({ id: "gone", hasPendingInteraction: true, archivedAt: NOON }),
    ]);
    expect(list.map((entry) => entry.id)).toEqual([
      "waiting-long",
      "failed",
      "waiting-short",
      "running",
    ]);
  });

  it("counts threads that need you for the bell badge", () => {
    expect(
      countNeedsYou([
        thread({ id: "a", hasPendingInteraction: true }),
        thread({ id: "b", status: "error", lastReadAt: NOON - 10_000 }),
        thread({ id: "c" }),
      ]),
    ).toBe(2);
  });
});

describe("buildTimelineSections", () => {
  it("keeps threads that need you out of the day groups", () => {
    const waiting = thread({
      id: "thr_waiting",
      hasPendingInteraction: true,
      updatedAt: NOON - 1000,
    });
    const idle = thread({ id: "thr_idle", updatedAt: NOON - 2000 });
    const sections = buildTimelineSections([waiting, idle], NOON);
    expect(sections.priority.map((entry) => entry.id)).toEqual(["thr_waiting"]);
    expect(
      sections.groups.map((group) => [
        group.id,
        group.threads.map((entry) => entry.id),
      ]),
    ).toEqual([["today", ["thr_idle"]]]);
  });
});
