import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
} from "@kaioken/domain";
import type { Host, ProjectSource, ThreadListEntry } from "@kaioken/domain";
import {
  buildPriorityList,
  buildTimelineGroups,
  isListedThread,
  type TimelineGroup,
} from "./sidebar-timeline";

export const UNIFIED_PROJECTS_PREVIEW_COUNT = 8;
export const UNIFIED_PROJECT_THREADS_PREVIEW_COUNT = 3;
export const UNIFIED_RECENTS_PREVIEW_COUNT = 12;

export type UnifiedProjectsSort = "recent" | "name" | "machine";

export interface UnifiedProjectMachine {
  id: string;
  name: string;
  connected: boolean;
  remote: boolean;
}

export interface UnifiedProjectLike {
  id: string;
  name: string;
  sources: readonly ProjectSource[];
}

export interface UnifiedSectionLike {
  id: string;
  name: string;
  projectIds: readonly string[];
}

export interface UnifiedProjectGroup<P extends UnifiedProjectLike> {
  project: P;
  threads: ThreadListEntry[];
  machine: UnifiedProjectMachine | null;
  lastActivityAt: number;
}

export interface UnifiedCustomSection<P extends UnifiedProjectLike> {
  id: string;
  name: string;
  projects: UnifiedProjectGroup<P>[];
  threads: ThreadListEntry[];
}

export interface UnifiedSidebar<P extends UnifiedProjectLike> {
  pinned: ThreadListEntry[];
  sections: UnifiedCustomSection<P>[];
  projects: UnifiedProjectGroup<P>[];
  recents: TimelineGroup[];
}

export interface BuildUnifiedSidebarArgs<P extends UnifiedProjectLike> {
  threads: readonly ThreadListEntry[];
  projects: readonly P[];
  sections: readonly UnifiedSectionLike[];
  pinnedThreadIds: readonly string[];
  hosts: readonly Host[];
  primaryHostId: string | null;
  projectsSort: UnifiedProjectsSort;
  now: number;
}

function byNewest(left: ThreadListEntry, right: ThreadListEntry): number {
  return right.updatedAt - left.updatedAt;
}

export function projectMachine(
  sources: readonly ProjectSource[],
  hosts: readonly Host[],
  primaryHostId: string | null,
): UnifiedProjectMachine | null {
  const local =
    primaryHostId === null
      ? undefined
      : findLocalPathProjectSourceForHost(sources, primaryHostId);
  const source =
    local ??
    sources.find(
      (candidate) => candidate.type === "local_path" && candidate.isDefault,
    ) ??
    sources.find((candidate) => candidate.type === "local_path");
  if (source === undefined || source.type !== "local_path") return null;
  const host = hosts.find((candidate) => candidate.id === source.hostId);
  if (host === undefined) return null;
  return {
    id: host.id,
    name: host.name,
    connected: host.status === "connected",
    remote: host.id !== primaryHostId,
  };
}

function compareProjectGroups<P extends UnifiedProjectLike>(
  sort: UnifiedProjectsSort,
): (left: UnifiedProjectGroup<P>, right: UnifiedProjectGroup<P>) => number {
  const byName = (
    left: UnifiedProjectGroup<P>,
    right: UnifiedProjectGroup<P>,
  ) =>
    left.project.name.localeCompare(right.project.name, undefined, {
      sensitivity: "base",
    });
  if (sort === "name") return byName;
  if (sort === "machine") {
    return (left, right) => {
      const leftRemote = left.machine?.remote ? 1 : 0;
      const rightRemote = right.machine?.remote ? 1 : 0;
      if (leftRemote !== rightRemote) return leftRemote - rightRemote;
      const machine = (left.machine?.name ?? "").localeCompare(
        right.machine?.name ?? "",
        undefined,
        { sensitivity: "base" },
      );
      return machine !== 0 ? machine : byName(left, right);
    };
  }
  return (left, right) =>
    right.lastActivityAt - left.lastActivityAt || byName(left, right);
}

export function buildUnifiedSidebar<P extends UnifiedProjectLike>({
  threads,
  projects,
  sections,
  pinnedThreadIds,
  hosts,
  primaryHostId,
  projectsSort,
  now,
}: BuildUnifiedSidebarArgs<P>): UnifiedSidebar<P> {
  const listed = threads.filter(isListedThread);
  const shown = new Set<string>();
  const threadById = new Map(listed.map((thread) => [thread.id, thread]));
  const pinned: ThreadListEntry[] = [];
  for (const id of pinnedThreadIds) {
    const thread = threadById.get(id);
    if (thread === undefined || shown.has(id)) continue;
    pinned.push(thread);
    shown.add(id);
  }

  const threadsByProject = new Map<string, ThreadListEntry[]>();
  for (const thread of listed) {
    if (thread.parentThreadId !== null) continue;
    const bucket = threadsByProject.get(thread.projectId);
    if (bucket === undefined) threadsByProject.set(thread.projectId, [thread]);
    else bucket.push(thread);
  }
  const groupFor = (project: P): UnifiedProjectGroup<P> => {
    const projectThreads = [...(threadsByProject.get(project.id) ?? [])].sort(
      byNewest,
    );
    return {
      project,
      threads: projectThreads,
      machine: projectMachine(project.sources, hosts, primaryHostId),
      lastActivityAt: projectThreads[0]?.updatedAt ?? 0,
    };
  };
  const comparator = compareProjectGroups<P>(projectsSort);
  const sectioned = new Set<string>();
  const projectById = new Map(projects.map((project) => [project.id, project]));
  const customSections = sections.map((section): UnifiedCustomSection<P> => {
    const sectionProjects: UnifiedProjectGroup<P>[] = [];
    for (const projectId of section.projectIds) {
      const project = projectById.get(projectId);
      if (project === undefined) continue;
      sectioned.add(projectId);
      sectionProjects.push(groupFor(project));
    }
    sectionProjects.sort(comparator);
    const sectionThreads = listed
      .filter(
        (thread) =>
          thread.sectionId === section.id &&
          !shown.has(thread.id) &&
          !sectioned.has(thread.projectId),
      )
      .sort(byNewest);
    return {
      id: section.id,
      name: section.name,
      projects: sectionProjects,
      threads: sectionThreads,
    };
  });

  const projectGroups = projects
    .filter((project) => !sectioned.has(project.id))
    .map(groupFor)
    .sort(comparator);

  const recents = buildTimelineGroups(
    listed.filter(
      (thread) =>
        thread.projectId === PERSONAL_PROJECT_ID &&
        !shown.has(thread.id) &&
        thread.pinnedAt === null,
    ),
    now,
  );
  return {
    pinned,
    sections: customSections,
    projects: projectGroups,
    recents,
  };
}

export interface PrioritySidebar {
  priority: ThreadListEntry[];
  groups: TimelineGroup[];
}

export function buildPrioritySidebar(
  threads: readonly ThreadListEntry[],
  now: number,
): PrioritySidebar {
  const priority = buildPriorityList(threads);
  const prioritized = new Set(priority.map((thread) => thread.id));
  const rest = threads
    .filter((thread) => !prioritized.has(thread.id))
    .map((thread) =>
      thread.pinnedAt === null ? thread : { ...thread, pinnedAt: null },
    );
  return { priority, groups: buildTimelineGroups(rest, now) };
}
