import { atomWithStorage } from "jotai/utils";
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

export const SIDEBAR_PRIORITY_MODE_STORAGE_KEY = "bb.sidebar.priorityMode";

export const priorityModeAtom = atomWithStorage<boolean>(
  SIDEBAR_PRIORITY_MODE_STORAGE_KEY,
  false,
);

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

export function isListedThread(thread: ThreadListEntry): boolean {
  return thread.visibility !== "hidden" && thread.archivedAt === null;
}

export type TimelineGroupId =
  | "pinned"
  | "today"
  | "yesterday"
  | "this-week"
  | "earlier";

export interface TimelineGroup {
  id: TimelineGroupId;
  label: string;
  threads: ThreadListEntry[];
}

const GROUP_LABELS: Record<TimelineGroupId, string> = {
  pinned: "Pinned",
  today: "Today",
  yesterday: "Yesterday",
  "this-week": "This week",
  earlier: "Earlier",
};

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function timelineGroupFor(
  thread: ThreadListEntry,
  now: number,
): TimelineGroupId {
  if (thread.pinnedAt !== null) return "pinned";
  const today = startOfDay(now);
  if (thread.updatedAt >= today) return "today";
  if (thread.updatedAt >= today - DAY_MS) return "yesterday";
  if (thread.updatedAt >= today - 6 * DAY_MS) return "this-week";
  return "earlier";
}

function byNewest(left: ThreadListEntry, right: ThreadListEntry): number {
  return right.updatedAt - left.updatedAt;
}

export function buildTimelineGroups(
  threads: readonly ThreadListEntry[],
  now: number,
): TimelineGroup[] {
  const buckets: Record<TimelineGroupId, ThreadListEntry[]> = {
    pinned: [],
    today: [],
    yesterday: [],
    "this-week": [],
    earlier: [],
  };
  for (const thread of threads) {
    if (!isListedThread(thread)) continue;
    buckets[timelineGroupFor(thread, now)].push(thread);
  }
  buckets.pinned.sort(
    (left, right) => (left.pinnedAt ?? 0) - (right.pinnedAt ?? 0),
  );
  buckets.today.sort(byNewest);
  buckets.yesterday.sort(byNewest);
  buckets["this-week"].sort(byNewest);
  buckets.earlier.sort(byNewest);
  return (Object.keys(buckets) as TimelineGroupId[])
    .filter((id) => buckets[id].length > 0)
    .map((id) => ({ id, label: GROUP_LABELS[id], threads: buckets[id] }));
}

export function buildPriorityList(
  threads: readonly ThreadListEntry[],
): ThreadListEntry[] {
  const needsYou: ThreadListEntry[] = [];
  const running: ThreadListEntry[] = [];
  for (const thread of threads) {
    if (!isListedThread(thread)) continue;
    if (threadNeedsYou(thread)) needsYou.push(thread);
    else if (threadIsRunning(thread)) running.push(thread);
  }
  needsYou.sort(
    (left, right) => left.latestAttentionAt - right.latestAttentionAt,
  );
  running.sort(byNewest);
  return [...needsYou, ...running];
}

export function countNeedsYou(threads: readonly ThreadListEntry[]): number {
  let count = 0;
  for (const thread of threads) {
    if (isListedThread(thread) && threadNeedsYou(thread)) count += 1;
  }
  return count;
}
