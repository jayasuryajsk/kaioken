import { useCallback, useMemo, useState, type ReactNode } from "react";
import { useAtom } from "jotai";
import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
  type ThreadListEntry,
} from "@kaioken/domain";
import type {
  ProjectResponse,
  ThreadSectionResponse,
} from "@kaioken/server-contract";
import {
  buildConnectionSidebarGroups,
  buildSectionKey,
  buildSidebarEntitySectionId,
  CONNECTION_CONTAINER_ID,
  getCollapsedChildActivity,
  isSidebarProjectThread,
  type ConnectionSidebarProject,
  type SidebarSectionDefinition,
  type ThreadComparator,
} from "@kaioken/client-core";
import { EmptyState } from "@kaioken/shared-ui/empty-state";
import { SidebarMenu, SidebarMenuItem } from "@/components/ui/sidebar.js";
import type { ConnectionAwareQueryStatus } from "@/hooks/queries/connection-aware-query-state";
import {
  isHostPathMissing,
  useHostPathExistence,
} from "@/hooks/queries/host-path-queries";
import { useHosts, usePrimaryHost } from "@/hooks/queries/host-queries";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import {
  ThreadSectionMoveProvider,
  type ThreadSectionMoveDestination,
} from "@/components/thread/ThreadSectionMoveProvider";
import {
  ProjectSectionMoveProvider,
  type ProjectSectionMoveDestination,
} from "@/components/project/ProjectSectionMoveProvider";
import {
  renderBuiltInSidebarSection,
  SortableSidebarSection,
  type BuiltInSidebarSectionOptions,
  type BuiltInSidebarSectionOptionsById,
} from "./BuiltInSidebarSection";
import { ProjectRow, ProjectThreadTree } from "./ProjectRow";
import type { ProjectThreadListState } from "./ProjectRow";
import { ReorderableSidebarSectionOrderList } from "./ReorderableSidebarSectionOrderList";
import {
  SidebarHeaderControls,
  SidebarSectionMenuItems,
} from "./SidebarHeaderControls";
import {
  collapsedProjectIdsAtom,
  sidebarCollapsedMachinesAtom,
  sidebarCollapsedThreadSectionsAtom,
  type CollapsibleSidebarSectionId,
  type SidebarSectionId,
} from "./sidebarCollapsedAtoms";
import { useSidebarModeSectionOrder } from "./useSidebarModeSectionOrder";

export const NO_SECTION_DESTINATION_LABEL = "No section";

interface ConnectionModeSectionsProps {
  collapsedEnvironmentIds: Set<string>;
  collapsedSectionIds: ReadonlySet<CollapsibleSidebarSectionId>;
  collapsedThreadIds: Set<string>;
  compareThreads: ThreadComparator;
  draftThreadIds: ReadonlySet<string>;
  effectivePinnedThreadIds: ReadonlySet<string>;
  isSectionDisplayOptionsOpen: (sectionId: SidebarSectionId) => boolean;
  onCreateProjectThread: (projectId: string) => void;
  onCreateThreadInSection: (sectionId: string) => void;
  onProjectSelect?: () => void;
  onRemoveSection: (section: SidebarSectionDefinition) => void;
  onRenameSection: (section: SidebarSectionDefinition) => void;
  onRequestNewSection: () => void;
  onToggleCollapsed: (id: CollapsibleSidebarSectionId) => void;
  onToggleEnvironmentCollapsed: (id: string) => void;
  onToggleThreadCollapsed: (id: string) => void;
  pinnedSection: BuiltInSidebarSectionOptions;
  projects: readonly ProjectResponse[];
  renderSectionDisplayOptions: (
    sectionId: SidebarSectionId,
    label: string,
  ) => ReactNode;
  sections: readonly ThreadSectionResponse[];
  selectedThreadId?: string;
  showPinnedSection: boolean;
  status: ConnectionAwareQueryStatus;
  threads: ThreadListEntry[];
  threadsSection: Omit<BuiltInSidebarSectionOptions, "content">;
}

function toggleId(current: string[], id: string): string[] {
  return current.includes(id)
    ? current.filter((value) => value !== id)
    : [...current, id];
}

export function connectionSectionCollapseKey(sectionId: string): string {
  return buildSectionKey(CONNECTION_CONTAINER_ID, sectionId);
}

export function ConnectionModeSections({
  collapsedEnvironmentIds,
  collapsedSectionIds,
  collapsedThreadIds,
  compareThreads,
  draftThreadIds,
  effectivePinnedThreadIds,
  isSectionDisplayOptionsOpen,
  onCreateProjectThread,
  onCreateThreadInSection,
  onProjectSelect,
  onRemoveSection,
  onRenameSection,
  onRequestNewSection,
  onToggleCollapsed,
  onToggleEnvironmentCollapsed,
  onToggleThreadCollapsed,
  pinnedSection,
  projects,
  renderSectionDisplayOptions,
  sections,
  selectedThreadId,
  showPinnedSection,
  status,
  threads,
  threadsSection,
}: ConnectionModeSectionsProps) {
  const progressiveDisclosureEnabled =
    useSystemConfig().data?.experiments.sidebarProgressiveDisclosure ?? false;
  const { data: hosts } = useHosts();
  const primaryHost = usePrimaryHost();
  const [collapsedProjectIdList, setCollapsedProjectIdList] = useAtom(
    collapsedProjectIdsAtom,
  );
  const [collapsedMachineKeyList, setCollapsedMachineKeyList] = useAtom(
    sidebarCollapsedMachinesAtom,
  );
  const [collapsedSectionKeyList, setCollapsedSectionKeyList] = useAtom(
    sidebarCollapsedThreadSectionsAtom,
  );
  const [openSectionActions, setOpenSectionActions] = useState<string | null>(
    null,
  );
  const collapsedProjectIds = useMemo(
    () => new Set(collapsedProjectIdList),
    [collapsedProjectIdList],
  );
  const collapsedMachineKeys = useMemo(
    () => new Set(collapsedMachineKeyList),
    [collapsedMachineKeyList],
  );
  const collapsedSectionKeys = useMemo(
    () => new Set(collapsedSectionKeyList),
    [collapsedSectionKeyList],
  );
  const toggleProjectCollapsed = useCallback(
    (projectId: string) =>
      setCollapsedProjectIdList((current) => toggleId(current, projectId)),
    [setCollapsedProjectIdList],
  );
  const toggleMachineCollapsed = useCallback(
    (machineKey: string) =>
      setCollapsedMachineKeyList((current) => toggleId(current, machineKey)),
    [setCollapsedMachineKeyList],
  );
  const toggleSectionCollapsed = useCallback(
    (sectionKey: string) =>
      setCollapsedSectionKeyList((current) => toggleId(current, sectionKey)),
    [setCollapsedSectionKeyList],
  );

  const workHostId =
    primaryHost?.status === "connected" ? primaryHost.id : null;
  const localSourcePathsByProjectId = useMemo(() => {
    const paths = new Map<string, string>();
    if (!workHostId) return paths;
    for (const project of projects) {
      const source = findLocalPathProjectSourceForHost(
        project.sources,
        workHostId,
      );
      if (source) paths.set(project.id, source.path);
    }
    return paths;
  }, [projects, workHostId]);
  const localPaths = useMemo(
    () => Array.from(localSourcePathsByProjectId.values()),
    [localSourcePathsByProjectId],
  );
  const pathExistence = useHostPathExistence(workHostId, localPaths);

  const visibleThreads = useMemo(
    () =>
      threads.filter(
        (thread) =>
          !effectivePinnedThreadIds.has(thread.id) &&
          isSidebarProjectThread(thread),
      ),
    [effectivePinnedThreadIds, threads],
  );
  const groups = useMemo(
    () =>
      buildConnectionSidebarGroups({
        hosts: hosts ?? [],
        primaryHostId: primaryHost?.id ?? null,
        projects,
        sections,
        threads: visibleThreads,
      }),
    [hosts, primaryHost?.id, projects, sections, visibleThreads],
  );

  const sectionIdByProjectId = useMemo(() => {
    const map = new Map<string, string>();
    for (const group of groups.sections) {
      for (const entry of group.projects)
        map.set(entry.project.id, group.section.id);
    }
    return map;
  }, [groups.sections]);
  const threadDestinations = useMemo<ThreadSectionMoveDestination[]>(
    () => [
      { label: NO_SECTION_DESTINATION_LABEL, sectionId: null },
      ...sections.map((section) => ({
        label: section.name,
        sectionId: section.id,
      })),
    ],
    [sections],
  );
  const projectDestinations = useMemo<ProjectSectionMoveDestination[]>(
    () => threadDestinations,
    [threadDestinations],
  );

  const sectionEntityIds = useMemo(
    () => [
      ...groups.sections.map((group) =>
        buildSidebarEntitySectionId("section", group.section.id),
      ),
      ...groups.machines.map((group) =>
        buildSidebarEntitySectionId("machine", group.key),
      ),
    ],
    [groups],
  );
  const looseThreadListState: ProjectThreadListState =
    status === "ready"
      ? { status: "ready", threads: groups.looseThreads }
      : status === "unavailable"
        ? { status: "unavailable" }
        : { status: "loading" };
  const { onOrderChange, order, persistedOrder } = useSidebarModeSectionOrder({
    mode: "connection",
    entitySectionIds: sectionEntityIds,
    hasThreadsSection:
      groups.looseThreads.length > 0 || sectionEntityIds.length === 0,
    showPinnedSection,
  });
  const reorderDisabled = order.length < 2;

  const renderProjectRows = (entries: readonly ConnectionSidebarProject[]) =>
    entries.map((entry) => (
      <ProjectRow
        key={entry.project.id}
        project={entry.project}
        threadListState={
          status === "ready"
            ? { status: "ready", threads: entry.threads }
            : status === "unavailable"
              ? { status: "unavailable" }
              : { status: "loading" }
        }
        progressiveDisclosureEnabled={progressiveDisclosureEnabled}
        selectedThreadId={selectedThreadId}
        isActive={false}
        isCollapsed={collapsedProjectIds.has(entry.project.id)}
        collapsedThreadIds={collapsedThreadIds}
        collapsedEnvironmentIds={collapsedEnvironmentIds}
        compareThreads={compareThreads}
        isLocalPathInvalid={isHostPathMissing(
          pathExistence,
          localSourcePathsByProjectId.get(entry.project.id),
        )}
        onProjectSelect={onProjectSelect}
        onCreateProjectThread={onCreateProjectThread}
        onToggleProjectCollapsed={toggleProjectCollapsed}
        onToggleThreadCollapsed={onToggleThreadCollapsed}
        onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
      />
    ));

  const builtInSections: BuiltInSidebarSectionOptionsById = {
    pinned: pinnedSection,
    threads: {
      ...threadsSection,
      activity: getCollapsedChildActivity(groups.looseThreads, draftThreadIds),
      collapsedThreads: groups.looseThreads,
      content: (
        <ProjectThreadTree
          projectId={PERSONAL_PROJECT_ID}
          threadListState={looseThreadListState}
          progressiveDisclosureEnabled={progressiveDisclosureEnabled}
          selectedThreadId={selectedThreadId}
          collapsedThreadIds={collapsedThreadIds}
          collapsedEnvironmentIds={collapsedEnvironmentIds}
          compareThreads={compareThreads}
          variant="section"
          onProjectSelect={onProjectSelect}
          onToggleThreadCollapsed={onToggleThreadCollapsed}
          onToggleEnvironmentCollapsed={onToggleEnvironmentCollapsed}
        />
      ),
    },
  };

  return (
    <ThreadSectionMoveProvider destinations={threadDestinations}>
      <ProjectSectionMoveProvider
        destinations={projectDestinations}
        sectionIdByProjectId={sectionIdByProjectId}
        requestNewSection={onRequestNewSection}
      >
        <ReorderableSidebarSectionOrderList
          order={order}
          reorderOrder={persistedOrder}
          onOrderChange={onOrderChange}
        >
          {(sectionId, consumeClickSuppression) => {
            const builtInSection = renderBuiltInSidebarSection({
              sectionId,
              sections: builtInSections,
              disabled: reorderDisabled,
              collapsedSectionIds,
              onToggleCollapsed,
              consumeClickSuppression,
              showPinnedSection,
            });
            if (builtInSection !== undefined) return builtInSection;

            const sectionGroup = groups.sections.find(
              (group) =>
                buildSidebarEntitySectionId("section", group.section.id) ===
                sectionId,
            );
            if (sectionGroup) {
              const { section } = sectionGroup;
              const collapseKey = connectionSectionCollapseKey(section.id);
              const sectionThreads = [
                ...sectionGroup.projects.flatMap((entry) => entry.threads),
                ...sectionGroup.threads,
              ];
              const isEmpty =
                sectionGroup.projects.length === 0 &&
                sectionGroup.threads.length === 0;
              return (
                <SortableSidebarSection
                  key={sectionId}
                  id={sectionId}
                  sectionId={section.id}
                  label={section.name}
                  disabled={reorderDisabled}
                  actions={
                    <SidebarHeaderControls
                      label={`${section.name} section`}
                      onNewThread={() => onCreateThreadInSection(section.id)}
                      open={openSectionActions === section.id}
                      onOpenChange={(open) =>
                        setOpenSectionActions((current) =>
                          open
                            ? section.id
                            : current === section.id
                              ? null
                              : current,
                        )
                      }
                    >
                      <SidebarSectionMenuItems
                        onRename={() => onRenameSection(section)}
                        onRemove={() => onRemoveSection(section)}
                      />
                    </SidebarHeaderControls>
                  }
                  actionsOpen={openSectionActions === section.id}
                  actionsMobileAlways
                  collapsedActivity={getCollapsedChildActivity(
                    sectionThreads,
                    draftThreadIds,
                  )}
                  collapsedThreads={sectionThreads}
                  collapseControl={{
                    isCollapsed: collapsedSectionKeys.has(collapseKey),
                    onToggleCollapsed: () =>
                      toggleSectionCollapsed(collapseKey),
                  }}
                  consumeClickSuppression={consumeClickSuppression}
                >
                  <SidebarMenu
                    className="gap-1"
                    data-testid={`sidebar-section-${section.id}`}
                  >
                    {renderProjectRows(sectionGroup.projects)}
                    {sectionGroup.threads.length > 0 ? (
                      <ProjectThreadTree
                        threadListState={{
                          status: "ready",
                          threads: sectionGroup.threads,
                        }}
                        progressiveDisclosureEnabled={
                          progressiveDisclosureEnabled
                        }
                        selectedThreadId={selectedThreadId}
                        collapsedThreadIds={collapsedThreadIds}
                        collapsedEnvironmentIds={collapsedEnvironmentIds}
                        compareThreads={compareThreads}
                        variant="section"
                        onProjectSelect={onProjectSelect}
                        onToggleThreadCollapsed={onToggleThreadCollapsed}
                        onToggleEnvironmentCollapsed={
                          onToggleEnvironmentCollapsed
                        }
                      />
                    ) : null}
                    {isEmpty ? (
                      <SidebarMenuItem>
                        <EmptyState
                          message="Move repos or threads here from their menus"
                          icon="SectionAdd"
                          className="px-2 py-1.5"
                          iconClassName="size-3.5 text-subtle-foreground/50"
                          messageClassName="text-xs text-subtle-foreground/60"
                        />
                      </SidebarMenuItem>
                    ) : null}
                  </SidebarMenu>
                </SortableSidebarSection>
              );
            }

            const machineGroup = groups.machines.find(
              (group) =>
                buildSidebarEntitySectionId("machine", group.key) === sectionId,
            );
            if (!machineGroup) return null;
            const machineThreads = machineGroup.projects.flatMap(
              (entry) => entry.threads,
            );
            return (
              <SortableSidebarSection
                key={sectionId}
                id={sectionId}
                label={machineGroup.label}
                disabled={reorderDisabled}
                actions={renderSectionDisplayOptions(
                  sectionId,
                  machineGroup.label,
                )}
                actionsOpen={isSectionDisplayOptionsOpen(sectionId)}
                actionsMobileAlways
                collapsedActivity={getCollapsedChildActivity(
                  machineThreads,
                  draftThreadIds,
                )}
                collapsedThreads={machineThreads}
                collapseControl={{
                  isCollapsed: collapsedMachineKeys.has(machineGroup.key),
                  onToggleCollapsed: () =>
                    toggleMachineCollapsed(machineGroup.key),
                }}
                consumeClickSuppression={consumeClickSuppression}
              >
                <SidebarMenu
                  className="gap-1"
                  data-testid={`sidebar-machine-${machineGroup.key}`}
                >
                  {machineGroup.projects.length > 0 ? (
                    renderProjectRows(machineGroup.projects)
                  ) : (
                    <SidebarMenuItem>
                      <EmptyState
                        message={
                          status === "unavailable"
                            ? "Projects unavailable"
                            : "No repos on this machine"
                        }
                        icon="Folder"
                        className="px-2 py-1.5"
                        iconClassName="size-3.5 text-subtle-foreground/50"
                        messageClassName="text-xs text-subtle-foreground/60"
                      />
                    </SidebarMenuItem>
                  )}
                </SidebarMenu>
              </SortableSidebarSection>
            );
          }}
        </ReorderableSidebarSectionOrderList>
      </ProjectSectionMoveProvider>
    </ThreadSectionMoveProvider>
  );
}
