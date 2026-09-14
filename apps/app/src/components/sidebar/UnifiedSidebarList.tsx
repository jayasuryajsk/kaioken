import { useCallback, useMemo, useState, type ReactNode } from "react";
import { NavLink, useMatch } from "react-router-dom";
import { useAtom, useAtomValue } from "jotai";
import { atomWithStorage } from "jotai/utils";
import {
  mergeFederatedSidebar,
  remoteId,
  type RemoteProjectMachine,
  type RemoteThreadRef,
} from "@kaioken/client-core";
import type { ThreadListEntry } from "@kaioken/domain";
import { Button } from "@kaioken/shared-ui/button";
import { Icon } from "@kaioken/shared-ui/icon";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@kaioken/shared-ui/coarse-pointer-sizing";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kaioken/shared-ui/dropdown-menu";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  ProjectActionsContextMenu,
  ProjectActionsMenu,
} from "@/components/project/ProjectActionsMenu";
import {
  selectPersistentHosts,
  useHosts,
  usePrimaryHost,
} from "@/hooks/queries/host-queries";
import type { ProjectResponse } from "@kaioken/server-contract";
import { useFederatedRemotes } from "@/hooks/queries/federation-queries";
import {
  REMOTE_THREAD_ROUTE_PATH,
  getProjectComposeRoutePath,
} from "@/lib/route-paths";
import { sidebarPriorityViewAtom } from "@/lib/sidebar-priority-view";
import {
  buildPrioritySidebar,
  buildUnifiedSidebar,
  UNIFIED_PROJECT_THREADS_PREVIEW_COUNT,
  UNIFIED_PROJECTS_PREVIEW_COUNT,
  UNIFIED_RECENTS_PREVIEW_COUNT,
  type UnifiedProjectGroup,
  type UnifiedProjectsSort,
  type UnifiedSectionLike,
} from "@/lib/sidebar-unified";
import {
  collapsedProjectIdsAtom,
  expandedProjectIdsAtom,
  sidebarMergeServersAtom,
  sidebarProjectsSortAtom,
} from "./sidebarCollapsedAtoms";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
} from "./sidebarRowClasses";
import { SidebarSectionMenuItems } from "./SidebarHeaderControls";
import { SidebarControlButton, SidebarRowControls } from "./SidebarRowControls";
import {
  TimelineRow,
  formatOfflineMeta,
  remoteThreadTooltip,
  useNow,
  useTimelineMachines,
  useViewerHostId,
} from "./TimelineThreadList";

interface RemoteProjectServer {
  handle: string;
  name: string;
  live: boolean;
  lastSeenAt: number | null;
}

export const UNIFIED_COLLAPSED_SECTIONS_STORAGE_KEY =
  "kaioken.sidebar.unified.collapsedSections";

const collapsedUnifiedSectionsAtom = atomWithStorage<string[]>(
  UNIFIED_COLLAPSED_SECTIONS_STORAGE_KEY,
  [],
);
export const UNIFIED_PROJECTS_SECTION_ID = "projects";
const RECENT_ACTIVITY_WINDOW_MS = 24 * 60 * 60 * 1000;

const PROJECT_SORT_OPTIONS: ReadonlyArray<{
  value: UnifiedProjectsSort;
  label: string;
  shortLabel: string;
}> = [
  { value: "recent", label: "Recent activity", shortLabel: "Recent" },
  { value: "name", label: "Name", shortLabel: "Name" },
  { value: "machine", label: "Machine", shortLabel: "Machine" },
];

function projectSortShortLabel(sort: UnifiedProjectsSort): string {
  return (
    PROJECT_SORT_OPTIONS.find((option) => option.value === sort)?.shortLabel ??
    "Recent"
  );
}

const SECTION_LABEL_CLASS = cn(
  "kaioken-sidebar-section-label flex h-7 min-w-0 items-center gap-1 px-2 text-xs",
  SIDEBAR_GROUP_TEXT_CLASS,
);
const SHOW_MORE_CLASS =
  "flex h-7 w-full items-center rounded-md px-2 text-xs text-subtle-foreground transition-colors hover:bg-sidebar-accent hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring";

export interface UnifiedSidebarListProps {
  threads: readonly ThreadListEntry[];
  projects: readonly ProjectResponse[];
  sections: readonly UnifiedSectionLike[];
  pinnedThreadIds: readonly string[];
  draftThreadIds: ReadonlySet<string>;
  selectedThreadId?: string;
  selectedProjectId?: string;
  onProjectSelect?: () => void;
  onNewProject?: () => void;
  isCreatingProject?: boolean;
  onCreateThreadInSection: (sectionId: string) => void;
  onRenameSection: (section: { id: string; name: string }) => void;
  onRemoveSection: (section: { id: string; name: string }) => void;
  onRequestNewSection?: () => void;
  now?: number;
}

function useToggleSet(): [ReadonlySet<string>, (id: string) => void] {
  const [ids, setIds] = useState<ReadonlySet<string>>(() => new Set());
  const toggle = useCallback((id: string) => {
    setIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  return [ids, toggle];
}

function ShowMoreRow({
  count,
  expanded,
  indent = false,
  onToggle,
  testId,
}: {
  count: number;
  expanded: boolean;
  indent?: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className={cn(SHOW_MORE_CLASS, indent && "pl-8")}
      onClick={onToggle}
    >
      {expanded ? "Show less" : `Show more (${count})`}
    </button>
  );
}

interface ProjectRowsProps {
  group: UnifiedProjectGroup<ProjectResponse>;
  draftThreadIds: ReadonlySet<string>;
  selectedThreadId?: string;
  selectedProjectId?: string;
  expanded: boolean;
  onToggleExpanded: (projectId: string) => void;
  showAllThreads: boolean;
  onToggleShowAllThreads: (projectId: string) => void;
  onProjectSelect?: () => void;
  remoteServer?: RemoteProjectServer;
  remoteThreadRefs?: ReadonlyMap<string, RemoteThreadRef>;
  now?: number;
}

function UnifiedProjectRows({
  group,
  draftThreadIds,
  selectedThreadId,
  selectedProjectId,
  expanded,
  onToggleExpanded,
  showAllThreads,
  onToggleShowAllThreads,
  onProjectSelect,
  remoteServer,
  remoteThreadRefs,
  now,
}: ProjectRowsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { project, machine, threads, needsYou } = group;
  const visibleThreads = showAllThreads
    ? threads
    : threads.slice(0, UNIFIED_PROJECT_THREADS_PREVIEW_COUNT);
  const hiddenCount = threads.length - visibleThreads.length;
  const isActive =
    selectedThreadId === undefined && selectedProjectId === project.id;
  const offline = remoteServer !== undefined && !remoteServer.live;
  const ProjectMenuWrapper =
    remoteServer === undefined
      ? ProjectActionsContextMenu
      : PlainProjectWrapper;
  return (
    <div
      data-testid="unified-project"
      data-project-id={project.id}
      data-expanded={expanded ? "true" : undefined}
      data-remote-server={remoteServer?.handle}
      data-offline={offline ? "true" : undefined}
    >
      <ProjectMenuWrapper project={project} onOpenChange={setMenuOpen}>
        <div
          data-testid="unified-project-row"
          title={
            remoteServer === undefined
              ? undefined
              : remoteThreadTooltip(remoteServer.name).replace(
                  "This thread",
                  "This project",
                )
          }
          className={cn(
            "group/project-row relative flex h-8 items-center gap-1 rounded-md px-1 text-sm transition-colors",
            isActive
              ? SIDEBAR_ROW_SELECTED_STATE_CLASS
              : "text-sidebar-foreground hover:bg-sidebar-accent",
            menuOpen && "bg-sidebar-accent",
            offline && "opacity-60",
          )}
        >
          {threads.length > 0 ? (
            <button
              type="button"
              aria-expanded={expanded}
              aria-label={`${expanded ? "Collapse" : "Expand"} ${project.name}`}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                onToggleExpanded(project.id);
              }}
              className="inline-flex size-5 shrink-0 items-center justify-center rounded-sm text-subtle-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            >
              <Icon
                name={expanded ? "FolderOpen" : "Folder"}
                className="size-3.5"
              />
            </button>
          ) : (
            <span className="inline-flex size-5 shrink-0 items-center justify-center text-subtle-foreground">
              <Icon name="Folder" className="size-3.5" aria-hidden="true" />
            </span>
          )}
          {remoteServer === undefined ? (
            <NavLink
              to={getProjectComposeRoutePath(project.id)}
              onClick={onProjectSelect}
              className="flex min-w-0 flex-1 items-center outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            >
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </NavLink>
          ) : (
            <button
              type="button"
              data-testid="unified-remote-project-name"
              onClick={() => onToggleExpanded(project.id)}
              className="flex min-w-0 flex-1 items-center text-left outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
            >
              <span className="min-w-0 flex-1 truncate">{project.name}</span>
            </button>
          )}
          <span
            className={cn(
              "flex shrink-0 items-center gap-1.5 text-xs text-subtle-foreground",
              remoteServer === undefined && "group-hover/project-row:hidden",
              menuOpen && "hidden",
            )}
          >
            {remoteServer !== undefined ? (
              <span
                data-testid="unified-project-server"
                className="flex shrink-0 items-center gap-1.5"
              >
                <span
                  className={cn("truncate", offline ? "max-w-40" : "max-w-28")}
                >
                  {offline
                    ? formatOfflineMeta(
                        remoteServer.lastSeenAt,
                        now ?? Date.now(),
                      )
                    : remoteServer.name}
                </span>
                <MachineStatusDot connected={remoteServer.live} />
              </span>
            ) : machine && !machine.isViewer ? (
              <span
                data-testid="unified-project-machine"
                className="flex shrink-0 items-center gap-1.5"
              >
                <span className="max-w-28 truncate">{machine.name}</span>
                <MachineStatusDot connected={machine.connected} />
              </span>
            ) : null}
            {needsYou ? (
              <span
                data-testid="unified-project-needs-you"
                aria-label={`${project.name} needs you`}
                className="size-1.5 shrink-0 rounded-full bg-warning"
              />
            ) : null}
          </span>
          {remoteServer === undefined ? (
            <span
              className={cn(
                "hidden shrink-0 group-hover/project-row:inline-flex",
                menuOpen && "inline-flex",
              )}
            >
              <ProjectActionsMenu
                project={project}
                triggerClassName={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "size-6")}
                onOpenChange={setMenuOpen}
              />
            </span>
          ) : null}
        </div>
      </ProjectMenuWrapper>
      {expanded && visibleThreads.length > 0 ? (
        <div data-testid="unified-project-threads" className="space-y-0.5">
          {visibleThreads.map((thread) => (
            <TimelineRow
              key={thread.id}
              thread={thread}
              hasDraft={draftThreadIds.has(thread.id)}
              isActive={thread.id === selectedThreadId}
              machine={null}
              onProjectSelect={onProjectSelect}
              showMeta={false}
              indent
              muted
              remote={remoteThreadRefs?.get(thread.id)}
              projectName={
                remoteServer === undefined ? undefined : project.name
              }
              now={now}
            />
          ))}
          {hiddenCount > 0 || showAllThreads ? (
            <ShowMoreRow
              indent
              count={hiddenCount}
              expanded={showAllThreads}
              onToggle={() => onToggleShowAllThreads(project.id)}
              testId={`unified-project-more-${project.id}`}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function PlainProjectWrapper({
  children,
}: {
  children: ReactNode;
  project: ProjectResponse;
  onOpenChange: (open: boolean) => void;
}) {
  return <>{children}</>;
}

function ProjectsSortMenu({
  sort,
  onChange,
  onNewSection,
}: {
  sort: UnifiedProjectsSort;
  onChange: (sort: UnifiedProjectsSort) => void;
  onNewSection?: () => void;
}) {
  const activeLabel = projectSortShortLabel(sort);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label={`Projects options (sorted by ${activeLabel})`}
          className={cn(
            SIDEBAR_CONTROL_BUTTON_CLASS,
            "h-6 w-auto gap-0.5 px-1.5 text-xs font-normal",
          )}
        >
          <span data-testid="unified-projects-sort">{activeLabel}</span>
          <Icon name="ChevronDown" className="size-3 shrink-0" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" mobileTitle="Projects">
        <DropdownMenuGroup aria-label="Sort projects by">
          {PROJECT_SORT_OPTIONS.map((option) => (
            <DropdownMenuItem
              key={option.value}
              role="menuitemradio"
              aria-checked={sort === option.value}
              onSelect={() => onChange(option.value)}
            >
              {option.label}
              <span className="ml-auto inline-flex size-4 shrink-0 items-center justify-center">
                {sort === option.value ? (
                  <Icon name="Check" className="size-4" />
                ) : null}
              </span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        {onNewSection ? (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={onNewSection}>
              <Icon name="SectionAdd" />
              New label
            </DropdownMenuItem>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function SectionMenu({
  label,
  onNewThread,
  onRename,
  onRemove,
}: {
  label: string;
  onNewThread: () => void;
  onRename: () => void;
  onRemove: () => void;
}) {
  return (
    <SidebarRowControls
      primaryAction={
        <SidebarControlButton
          label={`New thread in ${label}`}
          icon="MessageSquarePlus"
          onClick={onNewThread}
        />
      }
    >
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label={`${label} actions`}
            className={SIDEBAR_CONTROL_BUTTON_CLASS}
          >
            <Icon
              name="MoreHorizontal"
              className={COARSE_POINTER_ICON_SIZE_CLASS}
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" mobileTitle={`${label} actions`}>
          <SidebarSectionMenuItems onRename={onRename} onRemove={onRemove} />
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarRowControls>
  );
}

export function UnifiedSidebarList({
  threads,
  projects,
  sections,
  pinnedThreadIds,
  draftThreadIds,
  selectedThreadId,
  selectedProjectId,
  onProjectSelect,
  onNewProject,
  isCreatingProject = false,
  onCreateThreadInSection,
  onRenameSection,
  onRemoveSection,
  onRequestNewSection,
  now,
}: UnifiedSidebarListProps) {
  const hostsQuery = useHosts();
  const primaryHost = usePrimaryHost();
  const hosts = useMemo(
    () => selectPersistentHosts(hostsQuery.data),
    [hostsQuery.data],
  );
  const machineFor = useTimelineMachines();
  const viewerHostId = useViewerHostId();
  const clock = useNow();
  const [projectsSort, setProjectsSort] = useAtom(sidebarProjectsSortAtom);
  const [collapsedSectionIds, setCollapsedSectionIds] = useAtom(
    collapsedUnifiedSectionsAtom,
  );
  const collapsedSections = useMemo(
    () => new Set(collapsedSectionIds),
    [collapsedSectionIds],
  );
  const toggleSectionCollapsed = useCallback(
    (sectionId: string) => {
      setCollapsedSectionIds((current) =>
        current.includes(sectionId)
          ? current.filter((id) => id !== sectionId)
          : [...current, sectionId],
      );
    },
    [setCollapsedSectionIds],
  );
  const [showAllThreadIds, toggleShowAllThreads] = useToggleSet();
  const [expandedProjectIdList, setExpandedProjectIdList] = useAtom(
    expandedProjectIdsAtom,
  );
  const expandedProjectIds = useMemo(
    () => new Set(expandedProjectIdList),
    [expandedProjectIdList],
  );
  const projectsCollapsed = collapsedSections.has(UNIFIED_PROJECTS_SECTION_ID);
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const priorityView = useAtomValue(sidebarPriorityViewAtom);
  const mergeServers = useAtomValue(sidebarMergeServersAtom) === "on";
  const { remotes } = useFederatedRemotes({ enabled: mergeServers });
  const federated = useMemo(
    () =>
      mergeFederatedSidebar({
        home: { threads, projects, sections },
        remotes: mergeServers ? remotes : [],
      }),
    [mergeServers, projects, remotes, sections, threads],
  );
  const remoteServersByHandle = useMemo(() => {
    const byHandle = new Map<string, RemoteProjectServer>();
    for (const remote of remotes) {
      byHandle.set(remote.server.handle, {
        handle: remote.server.handle,
        name: remote.server.name,
        live: remote.status === "live",
        lastSeenAt: remote.server.lastSeenAt ?? remote.fetchedAt,
      });
    }
    return byHandle;
  }, [remotes]);
  const remoteProjectNames = useMemo(() => {
    const names = new Map<string, string>();
    for (const project of federated.projects) {
      if (federated.remoteProjectMachines.has(project.id)) {
        names.set(project.id, project.name);
      }
    }
    return names;
  }, [federated.projects, federated.remoteProjectMachines]);
  const remoteRouteMatch = useMatch(REMOTE_THREAD_ROUTE_PATH);
  const effectiveSelectedThreadId =
    selectedThreadId ??
    (remoteRouteMatch?.params.handle !== undefined &&
    remoteRouteMatch.params.threadId !== undefined
      ? remoteId(
          remoteRouteMatch.params.handle,
          remoteRouteMatch.params.threadId,
        )
      : undefined);
  const priorityModel = useMemo(
    () => buildPrioritySidebar(federated.threads, now ?? clock),
    [clock, federated.threads, now],
  );
  const model = useMemo(
    () =>
      buildUnifiedSidebar({
        threads: federated.threads,
        projects: federated.projects,
        sections: federated.sections,
        pinnedThreadIds,
        hosts,
        primaryHostId: primaryHost?.id ?? null,
        viewerHostId,
        projectsSort,
        now: now ?? clock,
        projectMachineOverrides: federated.remoteProjectMachines,
      }),
    [
      clock,
      federated,
      hosts,
      now,
      pinnedThreadIds,
      primaryHost?.id,
      projectsSort,
      viewerHostId,
    ],
  );
  const [collapsedProjectIdList, setCollapsedProjectIdList] = useAtom(
    collapsedProjectIdsAtom,
  );
  const collapsedProjectIds = useMemo(
    () => new Set(collapsedProjectIdList),
    [collapsedProjectIdList],
  );
  const isProjectExpanded = useCallback(
    (group: UnifiedProjectGroup<ProjectResponse>) => {
      if (group.project.id === selectedProjectId || group.needsYou) return true;
      if (collapsedProjectIds.has(group.project.id)) return false;
      return (
        expandedProjectIds.has(group.project.id) ||
        group.lastActivityAt > (now ?? clock) - RECENT_ACTIVITY_WINDOW_MS
      );
    },
    [clock, collapsedProjectIds, expandedProjectIds, now, selectedProjectId],
  );
  const toggleProjectExpanded = useCallback(
    (projectId: string) => {
      const group =
        model.projects.find((entry) => entry.project.id === projectId) ??
        model.sections
          .flatMap((section) => section.projects)
          .find((entry) => entry.project.id === projectId);
      const currentlyExpanded = group !== undefined && isProjectExpanded(group);
      if (currentlyExpanded) {
        setExpandedProjectIdList((current) =>
          current.filter((id) => id !== projectId),
        );
        setCollapsedProjectIdList((current) =>
          current.includes(projectId) ? current : [...current, projectId],
        );
      } else {
        setCollapsedProjectIdList((current) =>
          current.filter((id) => id !== projectId),
        );
        setExpandedProjectIdList((current) =>
          current.includes(projectId) ? current : [...current, projectId],
        );
      }
    },
    [
      isProjectExpanded,
      model.projects,
      model.sections,
      setCollapsedProjectIdList,
      setExpandedProjectIdList,
    ],
  );
  const renderThread = (thread: ThreadListEntry, showMeta: boolean) => {
    const remote = federated.remoteThreadRefs.get(thread.id);
    return (
      <TimelineRow
        key={thread.id}
        thread={thread}
        hasDraft={draftThreadIds.has(thread.id)}
        isActive={thread.id === effectiveSelectedThreadId}
        machine={remote === undefined ? machineFor(thread) : null}
        onProjectSelect={onProjectSelect}
        showMeta={showMeta}
        remote={remote}
        projectName={
          remote === undefined
            ? undefined
            : (remoteProjectNames.get(thread.projectId) ?? "Personal")
        }
        now={now ?? clock}
      />
    );
  };
  const renderProject = (group: UnifiedProjectGroup<ProjectResponse>) => {
    const remoteMachine: RemoteProjectMachine | undefined =
      federated.remoteProjectMachines.get(group.project.id);
    return (
      <UnifiedProjectRows
        key={group.project.id}
        group={group}
        draftThreadIds={draftThreadIds}
        selectedThreadId={effectiveSelectedThreadId}
        selectedProjectId={selectedProjectId}
        expanded={isProjectExpanded(group)}
        onToggleExpanded={toggleProjectExpanded}
        showAllThreads={showAllThreadIds.has(group.project.id)}
        onToggleShowAllThreads={toggleShowAllThreads}
        onProjectSelect={onProjectSelect}
        remoteServer={
          remoteMachine === undefined
            ? undefined
            : remoteServersByHandle.get(remoteMachine.id)
        }
        remoteThreadRefs={federated.remoteThreadRefs}
        now={now ?? clock}
      />
    );
  };
  const visibleProjects = projectsExpanded
    ? model.projects
    : model.projects.slice(0, UNIFIED_PROJECTS_PREVIEW_COUNT);
  const hiddenProjects = model.projects.length - visibleProjects.length;
  const recentThreads = model.recents.flatMap((group) =>
    group.threads.map((thread) => ({ group, thread })),
  );
  const visibleRecents = recentsExpanded
    ? recentThreads
    : recentThreads.slice(0, UNIFIED_RECENTS_PREVIEW_COUNT);
  const hiddenRecents = recentThreads.length - visibleRecents.length;
  const recentGroups = model.recents
    .map((group) => ({
      ...group,
      threads: visibleRecents
        .filter((entry) => entry.group.id === group.id)
        .map((entry) => entry.thread),
    }))
    .filter((group) => group.threads.length > 0);
  const isEmpty =
    model.pinned.length === 0 &&
    model.sections.length === 0 &&
    model.projects.length === 0 &&
    recentThreads.length === 0;

  if (priorityView) {
    return (
      <div
        data-testid="unified-sidebar-list"
        data-sidebar-view="priority"
        className="flex flex-col gap-4 px-2 pb-2 pt-1"
      >
        <section data-testid="unified-priority">
          <p className={SECTION_LABEL_CLASS}>Priority</p>
          {priorityModel.priority.length > 0 ? (
            <div className="space-y-0.5">
              {priorityModel.priority.map((thread) =>
                renderThread(thread, true),
              )}
            </div>
          ) : (
            <p className="px-2 py-1 text-xs text-subtle-foreground">
              Nothing needs attention
            </p>
          )}
        </section>
        {priorityModel.groups.map((group) => (
          <section key={group.id} data-testid={`unified-priority-${group.id}`}>
            <p className={SECTION_LABEL_CLASS}>{group.label}</p>
            <div className="space-y-0.5">
              {group.threads.map((thread) => renderThread(thread, true))}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div
      data-testid="unified-sidebar-list"
      data-sidebar-view="default"
      className="flex flex-col gap-4 px-2 pb-2 pt-1"
    >
      {model.pinned.length > 0 ? (
        <section data-testid="unified-pinned">
          <p className={SECTION_LABEL_CLASS}>Pinned</p>
          <div className="space-y-0.5">
            {model.pinned.map((thread) => renderThread(thread, false))}
          </div>
        </section>
      ) : null}
      {model.sections.map((section) => {
        const collapsed = collapsedSections.has(section.id);
        return (
          <section
            key={section.id}
            data-testid={`unified-section-${section.id}`}
            className="group/section"
          >
            <div className={cn(SECTION_LABEL_CLASS, "pr-0")}>
              <button
                type="button"
                aria-expanded={!collapsed}
                aria-label={`${collapsed ? "Expand" : "Collapse"} ${section.name}`}
                onClick={() => toggleSectionCollapsed(section.id)}
                className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring"
              >
                <span className="min-w-0 truncate">{section.name}</span>
                <Icon
                  name="ChevronRight"
                  className={cn(
                    "size-3 shrink-0 transition-transform",
                    !collapsed && "rotate-90",
                  )}
                />
              </button>
              <span className="ml-auto hidden shrink-0 group-hover/section:inline-flex focus-within:inline-flex has-[[data-state=open]]:inline-flex">
                <SectionMenu
                  label={section.name}
                  onNewThread={() => onCreateThreadInSection(section.id)}
                  onRename={() =>
                    onRenameSection({ id: section.id, name: section.name })
                  }
                  onRemove={() =>
                    onRemoveSection({ id: section.id, name: section.name })
                  }
                />
              </span>
            </div>
            {collapsed ? null : (
              <div className="space-y-0.5">
                {section.projects.map(renderProject)}
                {section.threads.map((thread) => renderThread(thread, false))}
                {section.projects.length === 0 &&
                section.threads.length === 0 ? (
                  <p className="px-2 py-1 text-xs text-subtle-foreground">
                    Empty. Move a repo or thread here from its menu.
                  </p>
                ) : null}
              </div>
            )}
          </section>
        );
      })}
      <section
        data-testid="unified-projects"
        data-collapsed={projectsCollapsed ? "true" : undefined}
      >
        <div className={cn(SECTION_LABEL_CLASS, "pr-0")}>
          <button
            type="button"
            aria-expanded={!projectsCollapsed}
            aria-label={`${projectsCollapsed ? "Expand" : "Collapse"} Projects`}
            onClick={() => toggleSectionCollapsed(UNIFIED_PROJECTS_SECTION_ID)}
            className="flex min-w-0 flex-1 items-center gap-1 rounded-sm text-left outline-none hover:text-foreground focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          >
            <span className="min-w-0 truncate">Projects</span>
            <Icon
              name="ChevronRight"
              className={cn(
                "size-3 shrink-0 transition-transform",
                !projectsCollapsed && "rotate-90",
              )}
            />
          </button>
          <span className="ml-auto inline-flex shrink-0 items-center">
            <ProjectsSortMenu
              sort={projectsSort}
              onChange={setProjectsSort}
              onNewSection={onRequestNewSection}
            />
            <SidebarControlButton
              label="New project"
              icon="Plus"
              onClick={() => onNewProject?.()}
              disabled={onNewProject === undefined || isCreatingProject}
            />
          </span>
        </div>
        {projectsCollapsed ? null : model.projects.length === 0 ? (
          <p className="px-2 py-1 text-xs text-subtle-foreground">
            No projects yet. Add one with +.
          </p>
        ) : (
          <div className="space-y-0.5">
            {visibleProjects.map(renderProject)}
            {hiddenProjects > 0 || projectsExpanded ? (
              <ShowMoreRow
                count={hiddenProjects}
                expanded={projectsExpanded}
                onToggle={() => setProjectsExpanded((current) => !current)}
                testId="unified-projects-more"
              />
            ) : null}
          </div>
        )}
      </section>
      {recentGroups.length > 0 ? (
        <section data-testid="unified-recents" className="flex flex-col gap-3">
          {recentGroups.map((group, index) => (
            <div key={group.id} data-testid={`unified-recents-${group.id}`}>
              <p className={SECTION_LABEL_CLASS}>
                {index === 0 ? "Recents" : group.label}
                {index === 0 && group.id !== "today" ? (
                  <span className="text-subtle-foreground">
                    · {group.label}
                  </span>
                ) : null}
              </p>
              <div className="space-y-0.5">
                {group.threads.map((thread) => renderThread(thread, true))}
              </div>
            </div>
          ))}
          {hiddenRecents > 0 || recentsExpanded ? (
            <ShowMoreRow
              count={hiddenRecents}
              expanded={recentsExpanded}
              onToggle={() => setRecentsExpanded((current) => !current)}
              testId="unified-recents-more"
            />
          ) : null}
        </section>
      ) : null}
      {isEmpty ? (
        <p className="px-2 py-2 text-xs text-muted-foreground">
          No threads yet. Start one above.
        </p>
      ) : null}
    </div>
  );
}
