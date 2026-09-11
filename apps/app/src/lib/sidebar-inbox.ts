import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
} from "@kaioken/client-core";
import type { ThreadListEntry } from "@kaioken/domain";

export const SIDEBAR_INBOX_STORAGE_KEY = "bb.sidebar.inbox";

export const AUTO_SETTLE_AFTER_MS = 3 * 24 * 60 * 60 * 1000;

const marksSchema = z.object({
  settled: z.record(z.string(), z.number()).default({}),
  snoozed: z.record(z.string(), z.number()).default({}),
});

export type InboxMarks = z.infer<typeof marksSchema>;

export const EMPTY_INBOX_MARKS: InboxMarks = marksSchema.parse({});

export function parseInboxMarks(raw: string | null): InboxMarks {
  if (raw === null) return EMPTY_INBOX_MARKS;
  try {
    const parsed = marksSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : EMPTY_INBOX_MARKS;
  } catch {
    return EMPTY_INBOX_MARKS;
  }
}

export const inboxMarksAtom = atomWithStorage<InboxMarks>(
  SIDEBAR_INBOX_STORAGE_KEY,
  EMPTY_INBOX_MARKS,
  {
    getItem: (key) => {
      try {
        return parseInboxMarks(localStorage.getItem(key));
      } catch {
        return EMPTY_INBOX_MARKS;
      }
    },
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },
    removeItem: (key) => {
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  },
  { getOnInit: true },
);

export type InboxTier =
  | "pinned"
  | "needs-you"
  | "running"
  | "recent"
  | "snoozed"
  | "settled";

export interface InboxItem {
  thread: ThreadListEntry;
  tier: InboxTier;
  waitingSince: number | null;
  settledAt: number | null;
  wakeAt: number | null;
}

export interface InboxShelves {
  pinned: InboxItem[];
  needsYou: InboxItem[];
  running: InboxItem[];
  recent: InboxItem[];
  snoozed: InboxItem[];
  settled: InboxItem[];
}

export function threadNeedsYou(thread: ThreadListEntry): boolean {
  if (thread.hasPendingInteraction) return true;
  if (thread.queuedWork === "failed") return true;
  return isUnreadDoneThread(thread) && thread.status === "error";
}

export function threadIsRunning(thread: ThreadListEntry): boolean {
  return (
    isRuntimeBusyThread(thread) ||
    thread.queuedWork === "waiting" ||
    hasActiveWorkflowActivity(thread) ||
    hasActiveBackgroundAgentActivity(thread) ||
    hasActiveBackgroundCommandActivity(thread) ||
    hasActivePlanModeActivity(thread) ||
    hasActiveGoalActivity(thread)
  );
}

export function classifyInboxThread(
  thread: ThreadListEntry,
  marks: InboxMarks,
  now: number,
): InboxItem {
  const base = {
    thread,
    waitingSince: null,
    settledAt: null,
    wakeAt: null,
  };
  if (threadNeedsYou(thread)) {
    return {
      ...base,
      tier: "needs-you",
      waitingSince: thread.latestAttentionAt,
    };
  }
  if (threadIsRunning(thread)) {
    return { ...base, tier: "running" };
  }
  if (thread.pinnedAt !== null) {
    return { ...base, tier: "pinned" };
  }
  const wakeAt = marks.snoozed[thread.id];
  if (wakeAt !== undefined && wakeAt > now) {
    return { ...base, tier: "snoozed", wakeAt };
  }
  const settledAt = marks.settled[thread.id];
  if (settledAt !== undefined && settledAt >= thread.updatedAt) {
    return { ...base, tier: "settled", settledAt };
  }
  if (now - thread.updatedAt > AUTO_SETTLE_AFTER_MS) {
    return { ...base, tier: "settled", settledAt: thread.updatedAt };
  }
  return { ...base, tier: "recent" };
}

function byNewest(left: InboxItem, right: InboxItem): number {
  return right.thread.updatedAt - left.thread.updatedAt;
}

export function buildInboxShelves(
  threads: readonly ThreadListEntry[],
  marks: InboxMarks,
  now: number,
): InboxShelves {
  const shelves: InboxShelves = {
    pinned: [],
    needsYou: [],
    running: [],
    recent: [],
    snoozed: [],
    settled: [],
  };
  for (const thread of threads) {
    if (thread.visibility === "hidden" || thread.archivedAt !== null) continue;
    const item = classifyInboxThread(thread, marks, now);
    switch (item.tier) {
      case "pinned":
        shelves.pinned.push(item);
        break;
      case "needs-you":
        shelves.needsYou.push(item);
        break;
      case "running":
        shelves.running.push(item);
        break;
      case "recent":
        shelves.recent.push(item);
        break;
      case "snoozed":
        shelves.snoozed.push(item);
        break;
      case "settled":
        shelves.settled.push(item);
        break;
    }
  }
  shelves.pinned.sort(
    (left, right) => (left.thread.pinnedAt ?? 0) - (right.thread.pinnedAt ?? 0),
  );
  shelves.needsYou.sort(
    (left, right) => (left.waitingSince ?? 0) - (right.waitingSince ?? 0),
  );
  shelves.running.sort(byNewest);
  shelves.recent.sort(byNewest);
  shelves.snoozed.sort(
    (left, right) => (left.wakeAt ?? 0) - (right.wakeAt ?? 0),
  );
  shelves.settled.sort(
    (left, right) => (right.settledAt ?? 0) - (left.settledAt ?? 0),
  );
  return shelves;
}

export function settleThread(
  marks: InboxMarks,
  threadId: string,
  now: number,
): InboxMarks {
  const { [threadId]: _unsnoozed, ...snoozed } = marks.snoozed;
  return { settled: { ...marks.settled, [threadId]: now }, snoozed };
}

export function unsettleThread(
  marks: InboxMarks,
  threadId: string,
): InboxMarks {
  const { [threadId]: _removed, ...settled } = marks.settled;
  return { ...marks, settled };
}

export function snoozeThread(
  marks: InboxMarks,
  threadId: string,
  wakeAt: number,
): InboxMarks {
  const { [threadId]: _unsettled, ...settled } = marks.settled;
  return { settled, snoozed: { ...marks.snoozed, [threadId]: wakeAt } };
}

export function unsnoozeThread(
  marks: InboxMarks,
  threadId: string,
): InboxMarks {
  const { [threadId]: _removed, ...snoozed } = marks.snoozed;
  return { ...marks, snoozed };
}

export interface SnoozePreset {
  id: string;
  label: string;
  wakeAt: (now: number) => number;
}

const HOUR_MS = 60 * 60 * 1000;

function nextMorning(now: number, daysAhead: number): number {
  const date = new Date(now);
  date.setDate(date.getDate() + daysAhead);
  date.setHours(9, 0, 0, 0);
  return date.getTime();
}

export const SNOOZE_PRESETS: readonly SnoozePreset[] = [
  { id: "1h", label: "1 hour", wakeAt: (now) => now + HOUR_MS },
  { id: "4h", label: "4 hours", wakeAt: (now) => now + 4 * HOUR_MS },
  {
    id: "tomorrow",
    label: "Tomorrow morning",
    wakeAt: (now) => nextMorning(now, 1),
  },
  {
    id: "next-week",
    label: "Next Monday",
    wakeAt: (now) => {
      const date = new Date(now);
      const daysUntilMonday = (8 - date.getDay()) % 7 || 7;
      return nextMorning(now, daysUntilMonday);
    },
  },
];

export function formatWaitDuration(sinceMs: number, now: number): string {
  const diff = Math.max(0, now - sinceMs);
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
