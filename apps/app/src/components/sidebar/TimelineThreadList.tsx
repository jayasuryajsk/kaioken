import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAtom } from "jotai";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
  isRuntimeBusyThread,
  isUnreadDoneThread,
} from "@kaioken/client-core";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@kaioken/domain";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "@/components/thread/ThreadActionsMenu";
import { useSidebarProjectName } from "@/components/thread/ThreadTitleMentions";
import { getThreadRoutePath } from "@/lib/route-paths";
import {
  buildPriorityList,
  buildTimelineGroups,
  countNeedsYou,
  priorityModeAtom,
} from "@/lib/sidebar-timeline";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
} from "./sidebarRowClasses";
import { ThreadStatusGlyph } from "./ThreadRow";
import { useThreadRowSplitDrag } from "./useThreadRowSplitDrag";

const CLOCK_TICK_MS = 60_000;

interface TimelineThreadListProps {
  draftThreadIds: ReadonlySet<string>;
  onProjectSelect?: () => void;
  selectedThreadId?: string;
  threads: readonly ThreadListEntry[];
}

function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

interface RowProps {
  hasDraft: boolean;
  isActive: boolean;
  onProjectSelect?: () => void;
  thread: ThreadListEntry;
}

function TimelineRow({
  hasDraft,
  isActive,
  onProjectSelect,
  thread,
}: RowProps) {
  const projectName = useSidebarProjectName(
    thread.projectId === PERSONAL_PROJECT_ID ? null : thread.projectId,
  );
  const title = getThreadDisplayTitle(thread);
  const unread = isUnreadDoneThread(thread);
  const [menuOpen, setMenuOpen] = useState(false);
  const { onPointerDown: onSplitDragPointerDown, openInSplit } =
    useThreadRowSplitDrag({
      projectId: thread.projectId,
      threadId: thread.id,
      title,
    });
  const splitAvailable = onSplitDragPointerDown !== undefined;
  return (
    <ThreadActionsContextMenu
      thread={thread}
      onOpenInSplit={splitAvailable ? openInSplit : undefined}
    >
      <div
        data-testid="timeline-row"
        className={cn(
          "group/timeline-row relative flex items-center gap-2 rounded-md py-1.5 pl-2 pr-1 text-sm transition-colors",
          isActive
            ? SIDEBAR_ROW_SELECTED_STATE_CLASS
            : "text-sidebar-foreground hover:bg-sidebar-accent",
          menuOpen && "bg-sidebar-accent",
        )}
      >
        <NavLink
          to={getThreadRoutePath({
            projectId: thread.projectId,
            threadId: thread.id,
          })}
          onPointerDown={onSplitDragPointerDown}
          onClick={(event) => {
            if (splitAvailable && (event.metaKey || event.ctrlKey)) {
              event.preventDefault();
              openInSplit();
              return;
            }
            onProjectSelect?.();
          }}
          data-sidebar-thread-id={thread.id}
          className="flex min-w-0 flex-1 flex-col outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <span
            className={cn(
              "min-w-0 truncate",
              unread && !isActive && "font-medium",
            )}
          >
            {title}
          </span>
          <span className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
            <Icon name="Folder" className="size-3 shrink-0" />
            <span className="min-w-0 truncate">{projectName ?? "Kaioken"}</span>
          </span>
        </NavLink>
        <span className="flex shrink-0 items-center">
          <span className="inline-flex size-6 items-center justify-center group-hover/timeline-row:hidden">
            <ThreadStatusGlyph
              hasPendingInteraction={thread.hasPendingInteraction}
              hasUnsubmittedDraft={hasDraft}
              hasUnreadError={unread && thread.status === "error"}
              hasUnreadSuccess={unread && thread.status !== "error"}
              isBackgroundAgentActive={hasActiveBackgroundAgentActivity(thread)}
              isBackgroundCommandActive={hasActiveBackgroundCommandActivity(
                thread,
              )}
              isGoalActive={hasActiveGoalActivity(thread)}
              isPlanModeActive={hasActivePlanModeActivity(thread)}
              isRuntimeActive={isRuntimeBusyThread(thread)}
              isWorkflowActive={hasActiveWorkflowActivity(thread)}
              queuedWork={thread.queuedWork}
            />
          </span>
          <span
            className={cn(
              "hidden group-hover/timeline-row:inline-flex",
              menuOpen && "inline-flex",
            )}
          >
            <ThreadActionsMenu
              thread={thread}
              onOpenInSplit={splitAvailable ? openInSplit : undefined}
              triggerClassName={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "size-6")}
              onOpenChange={setMenuOpen}
            />
          </span>
        </span>
      </div>
    </ThreadActionsContextMenu>
  );
}

export function TimelineThreadList({
  draftThreadIds,
  onProjectSelect,
  selectedThreadId,
  threads,
}: TimelineThreadListProps) {
  const now = useNow();
  const [priorityMode, setPriorityMode] = useAtom(priorityModeAtom);
  const needsYouCount = useMemo(() => countNeedsYou(threads), [threads]);
  const groups = useMemo(
    () =>
      priorityMode
        ? [
            {
              id: "priority",
              label: "Priority",
              threads: buildPriorityList(threads),
            },
          ]
        : buildTimelineGroups(threads, now),
    [now, priorityMode, threads],
  );
  const renderRow = (thread: ThreadListEntry) => (
    <TimelineRow
      key={thread.id}
      thread={thread}
      hasDraft={draftThreadIds.has(thread.id)}
      isActive={thread.id === selectedThreadId}
      onProjectSelect={onProjectSelect}
    />
  );
  return (
    <div data-testid="timeline-thread-list" className="px-2 pb-2">
      <div className="mb-1 flex h-7 items-center justify-end">
        <button
          type="button"
          aria-pressed={priorityMode}
          aria-label={
            priorityMode
              ? "Show all threads"
              : `Show only threads that need you or are running${
                  needsYouCount > 0 ? ` (${needsYouCount} waiting)` : ""
                }`
          }
          onClick={() => setPriorityMode((current) => !current)}
          className={cn(
            SIDEBAR_CONTROL_BUTTON_CLASS,
            "relative size-7",
            priorityMode && "bg-state-active text-foreground",
          )}
        >
          <Icon name="BellDot" className="size-4" />
          {needsYouCount > 0 ? (
            <span
              aria-hidden="true"
              className="absolute right-1 top-1 size-1.5 rounded-full bg-foreground"
            />
          ) : null}
        </button>
      </div>
      {groups.length === 0 ||
      groups.every((group) => group.threads.length === 0) ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          {priorityMode
            ? "Nothing needs you right now."
            : "No threads yet. Start one above."}
        </p>
      ) : (
        <div className="space-y-4">
          {groups
            .filter((group) => group.threads.length > 0)
            .map((group) => (
              <section
                key={group.id}
                data-testid={`timeline-group-${group.id}`}
              >
                <p
                  className={cn(
                    "kaioken-sidebar-section-label mb-1 px-2 text-xs",
                    SIDEBAR_GROUP_TEXT_CLASS,
                  )}
                >
                  {group.label}
                </p>
                <div className="space-y-0.5">
                  {group.threads.map(renderRow)}
                </div>
              </section>
            ))}
        </div>
      )}
    </div>
  );
}
