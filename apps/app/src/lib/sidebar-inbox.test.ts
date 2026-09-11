import { describe, expect, it } from "vitest";
import type { ThreadListEntry } from "@kaioken/domain";
import {
  AUTO_SETTLE_AFTER_MS,
  buildInboxShelves,
  classifyInboxThread,
  EMPTY_INBOX_MARKS,
  formatWaitDuration,
  parseInboxMarks,
  settleThread,
  snoozeThread,
  unsettleThread,
} from "./sidebar-inbox";

const NOW = 1_800_000_000_000;

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
    lastReadAt: NOW,
    latestAttentionAt: NOW - 1000,
    updatedAt: NOW - 1000,
    pinnedAt: null,
    archivedAt: null,
    visibility: "visible",
    ...overrides,
  } as ThreadListEntry;
}

describe("inbox classification", () => {
  it("puts blocked threads in needs-you regardless of settle or snooze", () => {
    const marks = {
      settled: { thr_1: NOW },
      snoozed: { thr_1: NOW + 60_000 },
    };
    const item = classifyInboxThread(
      thread({ hasPendingInteraction: true, latestAttentionAt: NOW - 5000 }),
      marks,
      NOW,
    );
    expect(item.tier).toBe("needs-you");
    expect(item.waitingSince).toBe(NOW - 5000);
  });

  it("treats a failed queued turn and an unread error as needing you", () => {
    expect(
      classifyInboxThread(
        thread({ queuedWork: "failed" }),
        EMPTY_INBOX_MARKS,
        NOW,
      ).tier,
    ).toBe("needs-you");
    expect(
      classifyInboxThread(
        thread({ status: "error", lastReadAt: NOW - 10_000 }),
        EMPTY_INBOX_MARKS,
        NOW,
      ).tier,
    ).toBe("needs-you");
  });

  it("keeps a working thread in running even when it was settled", () => {
    const item = classifyInboxThread(
      thread({
        runtime: { displayStatus: "active" } as ThreadListEntry["runtime"],
      }),
      { settled: { thr_1: NOW }, snoozed: {} },
      NOW,
    );
    expect(item.tier).toBe("running");
  });

  it("wakes a snoozed thread once its time passes and settles stale ones", () => {
    const asleep = classifyInboxThread(
      thread({}),
      { settled: {}, snoozed: { thr_1: NOW + 1 } },
      NOW,
    );
    expect(asleep.tier).toBe("snoozed");
    const awake = classifyInboxThread(
      thread({}),
      { settled: {}, snoozed: { thr_1: NOW - 1 } },
      NOW,
    );
    expect(awake.tier).toBe("recent");
    const stale = classifyInboxThread(
      thread({ updatedAt: NOW - AUTO_SETTLE_AFTER_MS - 1 }),
      EMPTY_INBOX_MARKS,
      NOW,
    );
    expect(stale.tier).toBe("settled");
  });

  it("un-settles a thread that got new activity after it was settled", () => {
    const item = classifyInboxThread(
      thread({ updatedAt: NOW }),
      { settled: { thr_1: NOW - 1000 }, snoozed: {} },
      NOW,
    );
    expect(item.tier).toBe("recent");
  });
});

describe("inbox shelves", () => {
  it("orders needs-you by longest wait and recent by newest, skipping archived", () => {
    const shelves = buildInboxShelves(
      [
        thread({ id: "a", updatedAt: NOW - 5 }),
        thread({ id: "b", updatedAt: NOW - 1 }),
        thread({
          id: "c",
          hasPendingInteraction: true,
          latestAttentionAt: NOW - 9_000,
        }),
        thread({
          id: "d",
          hasPendingInteraction: true,
          latestAttentionAt: NOW - 90_000,
        }),
        thread({ id: "e", archivedAt: NOW }),
        thread({ id: "f", pinnedAt: NOW - 3 }),
      ],
      EMPTY_INBOX_MARKS,
      NOW,
    );
    expect(shelves.needsYou.map((item) => item.thread.id)).toEqual(["d", "c"]);
    expect(shelves.recent.map((item) => item.thread.id)).toEqual(["b", "a"]);
    expect(shelves.pinned.map((item) => item.thread.id)).toEqual(["f"]);
    expect(shelves.settled).toEqual([]);
  });
});

describe("inbox marks", () => {
  it("settle clears a snooze, snooze clears a settle, unsettle removes the mark", () => {
    let marks = snoozeThread(EMPTY_INBOX_MARKS, "thr_1", NOW + 10);
    expect(marks.snoozed.thr_1).toBe(NOW + 10);
    marks = settleThread(marks, "thr_1", NOW);
    expect(marks.snoozed.thr_1).toBeUndefined();
    expect(marks.settled.thr_1).toBe(NOW);
    marks = snoozeThread(marks, "thr_1", NOW + 20);
    expect(marks.settled.thr_1).toBeUndefined();
    marks = unsettleThread(settleThread(marks, "thr_1", NOW), "thr_1");
    expect(marks.settled).toEqual({});
  });

  it("parses stored marks defensively", () => {
    expect(parseInboxMarks(null)).toEqual(EMPTY_INBOX_MARKS);
    expect(parseInboxMarks("{bad")).toEqual(EMPTY_INBOX_MARKS);
    expect(parseInboxMarks('{"settled":{"a":1}}')).toEqual({
      settled: { a: 1 },
      snoozed: {},
    });
  });

  it("formats wait durations compactly", () => {
    expect(formatWaitDuration(NOW - 30_000, NOW)).toBe("just now");
    expect(formatWaitDuration(NOW - 5 * 60_000, NOW)).toBe("5m");
    expect(formatWaitDuration(NOW - 3 * 3_600_000, NOW)).toBe("3h");
    expect(formatWaitDuration(NOW - 50 * 3_600_000, NOW)).toBe("2d");
  });
});
