import { useEffect, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
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
import {
  selectPersistentHosts,
  useHosts,
  usePrimaryHost,
} from "@/hooks/queries/host-queries";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import { getThreadRoutePath } from "@/lib/route-paths";
import { buildTimelineSections } from "@/lib/sidebar-timeline";
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

export function useNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), CLOCK_TICK_MS);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

interface RowMachine {
  name: string;
  remote: boolean;
}

export interface TimelineRowProps {
  hasDraft: boolean;
  isActive: boolean;
  machine: RowMachine | null;
  onProjectSelect?: () => void;
  thread: ThreadListEntry;
  showMeta?: boolean;
  indent?: boolean;
  muted?: boolean;
  statusText?: string;
}

export function useViewerHostId(): string | null {
  const { localDaemonHostId } = useHostDaemon();
  return localDaemonHostId;
}

export function useTimelineMachines(): (
  thread: ThreadListEntry,
) => RowMachine | null {
  const hostsQuery = useHosts();
  const primaryHost = usePrimaryHost();
  const viewerHostId = useViewerHostId();
  const hosts = useMemo(
    () => selectPersistentHosts(hostsQuery.data),
    [hostsQuery.data],
  );
  return useMemo(() => {
    const byId = new Map(hosts.map((host) => [host.id, host]));
    const reference = viewerHostId ?? primaryHost?.id ?? null;
    return (thread) => {
      const hostId = thread.environmentHostId;
      if (hostId === null) return null;
      const host = byId.get(hostId);
      if (host === undefined) return null;
      return { name: host.name, remote: host.id !== reference };
    };
  }, [hosts, primaryHost?.id, viewerHostId]);
}

export function TimelineRow({
  hasDraft,
  isActive,
  machine,
  onProjectSelect,
  thread,
  showMeta = true,
  indent = false,
  muted = false,
  statusText,
}: TimelineRowProps) {
  const projectName = useSidebarProjectName(
    thread.projectId === PERSONAL_PROJECT_ID ? null : thread.projectId,
  );
  const location = projectName ?? machine?.name ?? "Kaioken";
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
          "group/timeline-row relative flex items-center gap-2 rounded-md py-1 pr-1 text-sm transition-colors",
          indent ? "pl-4" : "pl-2",
          isActive
            ? SIDEBAR_ROW_SELECTED_STATE_CLASS
            : cn(
                "hover:bg-sidebar-accent",
                muted ? "text-muted-foreground" : "text-sidebar-foreground",
              ),
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
          {statusText !== undefined ? (
            <span
              data-testid="timeline-row-status"
              className="min-w-0 truncate text-xs text-muted-foreground"
            >
              {statusText}
            </span>
          ) : showMeta ? (
            <span
              data-testid="timeline-row-meta"
              className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
            >
              <Icon
                name={machine?.remote ? "Laptop" : "Folder"}
                className="size-3 shrink-0"
              />
              <span className="min-w-0 truncate">
                {location}
                {machine?.remote && projectName !== null ? (
                  <span className="text-subtle-foreground">
                    {" "}
                    · {machine.name}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}
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
  const machineFor = useTimelineMachines();
  const sections = useMemo(
    () => buildTimelineSections(threads, now),
    [now, threads],
  );
  const renderRow = (thread: ThreadListEntry) => (
    <TimelineRow
      key={thread.id}
      thread={thread}
      hasDraft={draftThreadIds.has(thread.id)}
      isActive={thread.id === selectedThreadId}
      machine={machineFor(thread)}
      onProjectSelect={onProjectSelect}
    />
  );
  const labelClass = cn(
    "kaioken-sidebar-section-label mb-1 px-2 text-xs",
    SIDEBAR_GROUP_TEXT_CLASS,
  );
  return (
    <div data-testid="timeline-thread-list" className="px-2 pb-2 pt-1">
      <div className="space-y-3">
        <section data-testid="timeline-group-priority">
          <p className={labelClass}>
            Priority
            {sections.priority.length > 0 ? (
              <span className="ml-1 text-subtle-foreground">
                {sections.priority.length}
              </span>
            ) : null}
          </p>
          {sections.priority.length > 0 ? (
            <div className="space-y-0.5">
              {sections.priority.map(renderRow)}
            </div>
          ) : (
            <p className="px-2 py-1 text-xs text-subtle-foreground">
              Nothing needs attention
            </p>
          )}
        </section>
        {sections.groups.length === 0 && sections.priority.length === 0 ? (
          <p className="px-2 py-2 text-xs text-muted-foreground">
            No threads yet. Start one above.
          </p>
        ) : null}
        {sections.groups.map((group) => (
          <section key={group.id} data-testid={`timeline-group-${group.id}`}>
            <p className={labelClass}>{group.label}</p>
            <div className="space-y-0.5">{group.threads.map(renderRow)}</div>
          </section>
        ))}
      </div>
    </div>
  );
}
