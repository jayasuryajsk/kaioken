import { useCallback, useMemo, useState } from "react";
import { NavLink } from "react-router-dom";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
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
import { getProjectComposeRoutePath } from "@/lib/route-paths";
import {
  buildUnifiedSidebar,
  UNIFIED_PROJECT_THREADS_PREVIEW_COUNT,
  UNIFIED_PROJECTS_PREVIEW_COUNT,
  UNIFIED_RECENTS_PREVIEW_COUNT,
  type UnifiedProjectGroup,
  type UnifiedProjectsSort,
  type UnifiedSectionLike,
} from "@/lib/sidebar-unified";
import { sidebarProjectsSortAtom } from "./sidebarCollapsedAtoms";
import {
  SIDEBAR_CONTROL_BUTTON_CLASS,
  SIDEBAR_GROUP_TEXT_CLASS,
  SIDEBAR_ROW_SELECTED_STATE_CLASS,
} from "./sidebarRowClasses";
import { SidebarSectionMenuItems } from "./SidebarHeaderControls";
import { SidebarControlButton, SidebarRowControls } from "./SidebarRowControls";
import { TimelineRow, useNow, useTimelineMachines } from "./TimelineThreadList";

export const UNIFIED_COLLAPSED_SECTIONS_STORAGE_KEY =
  "kaioken.sidebar.unified.collapsedSections";

const collapsedUnifiedSectionsAtom = atomWithStorage<string[]>(
  UNIFIED_COLLAPSED_SECTIONS_STORAGE_KEY,
  [],
);

const PROJECT_SORT_OPTIONS: ReadonlyArray<{
  value: UnifiedProjectsSort;
  label: string;
}> = [
  { value: "recent", label: "Recent activity" },
  { value: "name", label: "Name" },
  { value: "machine", label: "Machine" },
];

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
  onToggle,
  testId,
}: {
  count: number;
  expanded: boolean;
  onToggle: () => void;
  testId: string;
}) {
  return (
    <button
      type="button"
      data-testid={testId}
      className={SHOW_MORE_CLASS}
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
  expandedProjectIds: ReadonlySet<string>;
  onToggleProjectExpanded: (projectId: string) => void;
  onProjectSelect?: () => void;
}

function UnifiedProjectRows({
  group,
  draftThreadIds,
  selectedThreadId,
  selectedProjectId,
  expandedProjectIds,
  onToggleProjectExpanded,
  onProjectSelect,
}: ProjectRowsProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const { project, machine, threads } = group;
  const expanded = expandedProjectIds.has(project.id);
  const visibleThreads = expanded
    ? threads
    : threads.slice(0, UNIFIED_PROJECT_THREADS_PREVIEW_COUNT);
  const hiddenCount = threads.length - visibleThreads.length;
  const isActive =
    selectedThreadId === undefined && selectedProjectId === project.id;
  return (
    <div data-testid="unified-project" data-project-id={project.id}>
      <ProjectActionsContextMenu project={project} onOpenChange={setMenuOpen}>
        <div
          data-testid="unified-project-row"
          className={cn(
            "group/project-row relative flex h-8 items-center gap-2 rounded-md pl-2 pr-1 text-sm transition-colors",
            isActive
              ? SIDEBAR_ROW_SELECTED_STATE_CLASS
              : "text-sidebar-foreground hover:bg-sidebar-accent",
            menuOpen && "bg-sidebar-accent",
          )}
        >
          <NavLink
            to={getProjectComposeRoutePath(project.id)}
            onClick={onProjectSelect}
            className="flex min-w-0 flex-1 items-center gap-2 outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
          >
            <Icon
              name={machine?.remote ? "Laptop" : "Folder"}
              className="size-3.5 shrink-0 text-subtle-foreground"
            />
            <span className="min-w-0 flex-1 truncate">{project.name}</span>
            {machine?.remote ? (
              <span
                data-testid="unified-project-machine"
                className="flex shrink-0 items-center gap-1.5 text-xs text-subtle-foreground"
              >
                <span className="max-w-24 truncate">{machine.name}</span>
                <MachineStatusDot connected={machine.connected} />
              </span>
            ) : null}
          </NavLink>
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
        </div>
      </ProjectActionsContextMenu>
      {visibleThreads.length > 0 ? (
        <div className="space-y-0.5">
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
            />
          ))}
        </div>
      ) : null}
      {hiddenCount > 0 || expanded ? (
        <div className="pl-5">
          <ShowMoreRow
            count={hiddenCount}
            expanded={expanded}
            onToggle={() => onToggleProjectExpanded(project.id)}
            testId={`unified-project-more-${project.id}`}
          />
        </div>
      ) : null}
    </div>
  );
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
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-label="Projects options"
          className={SIDEBAR_CONTROL_BUTTON_CLASS}
        >
          <Icon
            name="MoreHorizontal"
            className={COARSE_POINTER_ICON_SIZE_CLASS}
          />
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
              New section
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
  const [expandedProjectIds, toggleProjectExpanded] = useToggleSet();
  const [projectsExpanded, setProjectsExpanded] = useState(false);
  const [recentsExpanded, setRecentsExpanded] = useState(false);
  const model = useMemo(
    () =>
      buildUnifiedSidebar({
        threads,
        projects,
        sections,
        pinnedThreadIds,
        hosts,
        primaryHostId: primaryHost?.id ?? null,
        projectsSort,
        now: now ?? clock,
      }),
    [
      clock,
      hosts,
      now,
      pinnedThreadIds,
      primaryHost?.id,
      projects,
      projectsSort,
      sections,
      threads,
    ],
  );
  const renderThread = (thread: ThreadListEntry, showMeta: boolean) => (
    <TimelineRow
      key={thread.id}
      thread={thread}
      hasDraft={draftThreadIds.has(thread.id)}
      isActive={thread.id === selectedThreadId}
      machine={machineFor(thread)}
      onProjectSelect={onProjectSelect}
      showMeta={showMeta}
    />
  );
  const renderProject = (group: UnifiedProjectGroup<ProjectResponse>) => (
    <UnifiedProjectRows
      key={group.project.id}
      group={group}
      draftThreadIds={draftThreadIds}
      selectedThreadId={selectedThreadId}
      selectedProjectId={selectedProjectId}
      expandedProjectIds={expandedProjectIds}
      onToggleProjectExpanded={toggleProjectExpanded}
      onProjectSelect={onProjectSelect}
    />
  );
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
    model.priority.length === 0 &&
    model.pinned.length === 0 &&
    model.sections.length === 0 &&
    model.projects.length === 0 &&
    recentThreads.length === 0;

  return (
    <div
      data-testid="unified-sidebar-list"
      className="flex flex-col gap-3 px-2 pb-2 pt-1"
    >
      <section data-testid="unified-priority" data-sidebar-section="priority">
        <p className={SECTION_LABEL_CLASS}>
          Priority
          {model.priority.length > 0 ? (
            <span className="text-subtle-foreground">
              {model.priority.length}
            </span>
          ) : null}
        </p>
        {model.priority.length > 0 ? (
          <div className="space-y-0.5">
            {model.priority.map((thread) => renderThread(thread, true))}
          </div>
        ) : (
          <p className="px-2 py-1 text-xs text-subtle-foreground">
            Nothing needs attention
          </p>
        )}
      </section>
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
      <section data-testid="unified-projects">
        <div className={cn(SECTION_LABEL_CLASS, "pr-0")}>
          <span className="min-w-0 truncate">Projects</span>
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
        {model.projects.length === 0 ? (
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
