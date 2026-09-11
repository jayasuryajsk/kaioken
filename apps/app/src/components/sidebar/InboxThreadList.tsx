import { useEffect, useMemo, useState, type ReactNode } from "react";
import { NavLink } from "react-router-dom";
import { useAtom } from "jotai";
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
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@kaioken/domain";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kaioken/shared-ui/dropdown-menu";
import {
  ThreadActionsContextMenu,
  ThreadActionsMenu,
} from "@/components/thread/ThreadActionsMenu";
import { useSidebarProjectName } from "@/components/thread/ThreadTitleMentions";
import { formatRelativeTime } from "@/lib/relative-time";
import { getThreadRoutePath } from "@/lib/route-paths";
import {
  buildInboxShelves,
  formatWaitDuration,
  inboxMarksAtom,
  settleThread,
  SNOOZE_PRESETS,
  snoozeThread,
  unsettleThread,
  unsnoozeThread,
  type InboxItem,
} from "@/lib/sidebar-inbox";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { SidebarChildToggleChevron } from "./SidebarChildToggleChevron";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
} from "./sidebarRowClasses";
import { ThreadStatusGlyph } from "./ThreadRow";

const CLOCK_TICK_MS = 30_000;

const collapsedShelvesAtom = atomWithStorage<string[]>(
  "bb.sidebar.inbox.collapsed",
  ["snoozed", "settled"],
);

interface InboxThreadListProps {
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

interface ShelfProps {
  children: ReactNode;
  collapsed: boolean;
  count: number;
  id: string;
  label: string;
  onToggle: (id: string) => void;
}

function Shelf({
  children,
  collapsed,
  count,
  id,
  label,
  onToggle,
}: ShelfProps) {
  if (count === 0) return null;
  return (
    <section data-testid={`inbox-shelf-${id}`} className="space-y-0.5">
      <div
        className={cn(
          "flex h-6 w-full items-center gap-1 rounded-md px-2 text-xs",
          SIDEBAR_GROUP_TEXT_CLASS,
        )}
      >
        <button
          type="button"
          onClick={() => onToggle(id)}
          className="kaioken-sidebar-section-label flex min-w-0 flex-1 items-center gap-1 text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <span className="min-w-0 truncate">{label}</span>
          <span className="tabular-nums text-subtle-foreground">{count}</span>
        </button>
        <SidebarChildToggleChevron
          isCollapsed={collapsed}
          expandLabel={`Expand ${label}`}
          collapseLabel={`Collapse ${label}`}
          onToggle={() => onToggle(id)}
        />
      </div>
      {collapsed ? null : <div className="space-y-0.5">{children}</div>}
    </section>
  );
}

interface CardProps {
  compact: boolean;
  hasDraft: boolean;
  isActive: boolean;
  item: InboxItem;
  now: number;
  onProjectSelect?: () => void;
  onSettle: (threadId: string) => void;
  onSnooze: (threadId: string, wakeAt: number) => void;
  onUnsettle: (threadId: string) => void;
  onUnsnooze: (threadId: string) => void;
}

function metaLine(
  item: InboxItem,
  now: number,
  projectName: string | undefined,
): string {
  const parts: string[] = [];
  if (projectName) parts.push(projectName);
  if (item.thread.environmentBranchName) {
    parts.push(item.thread.environmentBranchName);
  }
  switch (item.tier) {
    case "needs-you":
      parts.push(
        `waiting ${formatWaitDuration(item.waitingSince ?? item.thread.updatedAt, now)}`,
      );
      break;
    case "snoozed":
      parts.push(
        `until ${new Date(item.wakeAt ?? now).toLocaleString(undefined, {
          weekday: "short",
          hour: "numeric",
          minute: "2-digit",
        })}`,
      );
      break;
    default:
      parts.push(formatRelativeTime({ timestamp: item.thread.updatedAt, now }));
  }
  return parts.join(" · ");
}

function InboxCard({
  compact,
  hasDraft,
  isActive,
  item,
  now,
  onProjectSelect,
  onSettle,
  onSnooze,
  onUnsettle,
  onUnsnooze,
}: CardProps) {
  const { thread } = item;
  const projectName = useSidebarProjectName(
    thread.projectId === PERSONAL_PROJECT_ID ? null : thread.projectId,
  );
  const title = getThreadDisplayTitle(thread);
  const unread = isUnreadDoneThread(thread);
  const [menuOpen, setMenuOpen] = useState(false);
  const glyph = (
    <ThreadStatusGlyph
      hasPendingInteraction={thread.hasPendingInteraction}
      hasUnsubmittedDraft={hasDraft}
      hasUnreadError={unread && thread.status === "error"}
      hasUnreadSuccess={unread && thread.status !== "error"}
      isBackgroundAgentActive={hasActiveBackgroundAgentActivity(thread)}
      isBackgroundCommandActive={hasActiveBackgroundCommandActivity(thread)}
      isGoalActive={hasActiveGoalActivity(thread)}
      isPlanModeActive={hasActivePlanModeActivity(thread)}
      isRuntimeActive={isRuntimeBusyThread(thread)}
      isWorkflowActive={hasActiveWorkflowActivity(thread)}
      queuedWork={thread.queuedWork}
    />
  );
  const parkMenu = (
    <DropdownMenu onOpenChange={setMenuOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label="Settle or snooze"
          className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "size-6")}
          onClick={(event) => event.stopPropagation()}
        >
          <Icon name="Clock" className="size-3.5" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {item.tier === "settled" ? (
          <DropdownMenuItem onSelect={() => onUnsettle(thread.id)}>
            Un-settle
          </DropdownMenuItem>
        ) : item.tier === "snoozed" ? (
          <DropdownMenuItem onSelect={() => onUnsnooze(thread.id)}>
            Wake now
          </DropdownMenuItem>
        ) : (
          <DropdownMenuItem
            disabled={item.tier === "running"}
            onSelect={() => onSettle(thread.id)}
          >
            Settle
          </DropdownMenuItem>
        )}
        {item.tier === "running" ? null : (
          <>
            <DropdownMenuSeparator />
            {SNOOZE_PRESETS.map((preset) => (
              <DropdownMenuItem
                key={preset.id}
                onSelect={() => onSnooze(thread.id, preset.wakeAt(now))}
              >
                Snooze · {preset.label}
              </DropdownMenuItem>
            ))}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
  return (
    <ThreadActionsContextMenu thread={thread}>
      <div
        data-testid="inbox-card"
        data-inbox-tier={item.tier}
        data-thread-indicator={item.tier}
        className={cn(
          "group/inbox-card relative flex items-start gap-2 rounded-md pl-2 pr-1 text-sm transition-colors",
          compact ? "py-0.5" : "py-1.5",
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
          onClick={onProjectSelect}
          data-sidebar-thread-id={thread.id}
          className="flex min-w-0 flex-1 items-start gap-2 outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
        >
          <span
            className={cn(
              "inline-flex size-4 shrink-0 items-center justify-center",
              compact ? "mt-0.5" : "mt-[3px]",
            )}
          >
            {glyph}
          </span>
          <span className="flex min-w-0 flex-1 flex-col">
            <span
              className={cn(
                "min-w-0 truncate",
                unread && !isActive && "font-medium",
                item.tier === "settled" && "text-muted-foreground",
              )}
            >
              {title}
            </span>
            {compact ? null : (
              <span className="truncate text-xs text-muted-foreground">
                {metaLine(item, now, projectName)}
              </span>
            )}
          </span>
        </NavLink>
        <span
          className={cn(
            "flex shrink-0 items-center opacity-0 transition-opacity group-hover/inbox-card:opacity-100 focus-within:opacity-100",
            menuOpen && "opacity-100",
          )}
        >
          {parkMenu}
          <ThreadActionsMenu
            thread={thread}
            triggerClassName={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "size-6")}
            onOpenChange={setMenuOpen}
          />
        </span>
      </div>
    </ThreadActionsContextMenu>
  );
}

export function InboxThreadList({
  draftThreadIds,
  onProjectSelect,
  selectedThreadId,
  threads,
}: InboxThreadListProps) {
  const now = useNow();
  const [marks, setMarks] = useAtom(inboxMarksAtom);
  const [collapsedList, setCollapsedList] = useAtom(collapsedShelvesAtom);
  const collapsed = useMemo(() => new Set(collapsedList), [collapsedList]);
  const shelves = useMemo(
    () => buildInboxShelves(threads, marks, now),
    [marks, now, threads],
  );
  const toggleShelf = (id: string) =>
    setCollapsedList((current) =>
      current.includes(id)
        ? current.filter((entry) => entry !== id)
        : [...current, id],
    );
  const handlers = {
    onProjectSelect,
    onSettle: (threadId: string) =>
      setMarks((current) => settleThread(current, threadId, Date.now())),
    onSnooze: (threadId: string, wakeAt: number) =>
      setMarks((current) => snoozeThread(current, threadId, wakeAt)),
    onUnsettle: (threadId: string) =>
      setMarks((current) => unsettleThread(current, threadId)),
    onUnsnooze: (threadId: string) =>
      setMarks((current) => unsnoozeThread(current, threadId)),
  };
  const renderItems = (items: InboxItem[], compact: boolean) =>
    items.map((item) => (
      <InboxCard
        key={item.thread.id}
        item={item}
        now={now}
        compact={compact}
        hasDraft={draftThreadIds.has(item.thread.id)}
        isActive={item.thread.id === selectedThreadId}
        {...handlers}
      />
    ));
  const total =
    shelves.pinned.length +
    shelves.needsYou.length +
    shelves.running.length +
    shelves.recent.length +
    shelves.snoozed.length +
    shelves.settled.length;
  if (total === 0) {
    return (
      <p className="px-2 py-3 text-xs text-muted-foreground">
        No threads yet. Start one above.
      </p>
    );
  }
  return (
    <div data-testid="inbox-thread-list" className="space-y-3 px-2 pb-2">
      <Shelf
        id="pinned"
        label="Pinned"
        count={shelves.pinned.length}
        collapsed={collapsed.has("pinned")}
        onToggle={toggleShelf}
      >
        {renderItems(shelves.pinned, false)}
      </Shelf>
      <Shelf
        id="needs-you"
        label="Needs you"
        count={shelves.needsYou.length}
        collapsed={collapsed.has("needs-you")}
        onToggle={toggleShelf}
      >
        {renderItems(shelves.needsYou, false)}
      </Shelf>
      <Shelf
        id="running"
        label="Running"
        count={shelves.running.length}
        collapsed={collapsed.has("running")}
        onToggle={toggleShelf}
      >
        {renderItems(shelves.running, false)}
      </Shelf>
      <Shelf
        id="recent"
        label="Recent"
        count={shelves.recent.length}
        collapsed={collapsed.has("recent")}
        onToggle={toggleShelf}
      >
        {renderItems(shelves.recent, false)}
      </Shelf>
      <Shelf
        id="snoozed"
        label="Snoozed"
        count={shelves.snoozed.length}
        collapsed={collapsed.has("snoozed")}
        onToggle={toggleShelf}
      >
        {renderItems(shelves.snoozed, true)}
      </Shelf>
      <Shelf
        id="settled"
        label="Settled"
        count={shelves.settled.length}
        collapsed={collapsed.has("settled")}
        onToggle={toggleShelf}
      >
        {renderItems(shelves.settled, true)}
      </Shelf>
    </div>
  );
}
