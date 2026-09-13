import {
  findLocalPathProjectSourceForHost,
  PERSONAL_PROJECT_ID,
} from "@kaioken/domain";
import type {
  Host,
  PendingInteraction,
  ProjectSource,
  ThreadListEntry,
} from "@kaioken/domain";
import {
  hasActiveBackgroundAgentActivity,
  hasActiveBackgroundCommandActivity,
  hasActiveGoalActivity,
  hasActivePlanModeActivity,
  hasActiveWorkflowActivity,
} from "@kaioken/client-core";
import {
  buildTimelineGroups,
  isListedThread,
  threadIsRunning,
  threadNeedsYou,
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
  needsYou: ThreadListEntry[];
  running: ThreadListEntry[];
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
  const needsYou = listed
    .filter(threadNeedsYou)
    .sort((left, right) => left.latestAttentionAt - right.latestAttentionAt);
  const running = listed
    .filter((thread) => !threadNeedsYou(thread) && threadIsRunning(thread))
    .sort(byNewest);
  const shown = new Set([...needsYou, ...running].map((thread) => thread.id));
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
    needsYou,
    running,
    pinned,
    sections: customSections,
    projects: projectGroups,
    recents,
  };
}

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function formatWaitDuration(waitMs: number): string {
  if (waitMs < MINUTE_MS) return "waiting now";
  if (waitMs < HOUR_MS) return `waiting ${Math.floor(waitMs / MINUTE_MS)}m`;
  if (waitMs < DAY_MS) return `waiting ${Math.floor(waitMs / HOUR_MS)}h`;
  return `waiting ${Math.floor(waitMs / DAY_MS)}d`;
}

export function describeRunningThread(thread: ThreadListEntry): string {
  if (thread.queuedWork === "waiting") return "Queued";
  if (hasActiveWorkflowActivity(thread)) return "Workflow running";
  if (hasActiveBackgroundAgentActivity(thread)) return "Background agent";
  if (hasActiveBackgroundCommandActivity(thread)) return "Background command";
  if (hasActivePlanModeActivity(thread)) return "Planning";
  if (hasActiveGoalActivity(thread)) return "Working on goal";
  switch (thread.runtime.displayStatus) {
    case "provisioning":
      return "Provisioning";
    case "host-reconnecting":
      return "Reconnecting to machine";
    case "waiting-for-host":
      return "Waiting for machine";
    default:
      return "Running";
  }
}

export type NeedsYouRequest =
  | {
      kind: "approval";
      summary: string;
      decisions: readonly ("allow_once" | "allow_for_session" | "deny")[];
    }
  | { kind: "question"; summary: string }
  | { kind: "input"; summary: string };

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .find((line) => line.trim().length > 0)
      ?.trim() ?? ""
  );
}

export function describeNeedsYouRequest(
  interaction: PendingInteraction,
): NeedsYouRequest {
  const payload = interaction.payload;
  if (payload.kind === "approval") {
    const subject = payload.subject;
    let summary: string;
    switch (subject.kind) {
      case "command":
        summary = firstLine(subject.command);
        break;
      case "file_change":
        summary =
          subject.writeScope === null
            ? "Edit files"
            : `Edit files in ${subject.writeScope}`;
        break;
      case "permission_grant":
        summary =
          subject.toolName === null
            ? "Grant permissions"
            : `Grant permissions to ${subject.toolName}`;
        break;
      case "plan":
        summary = "Review the plan";
        break;
      case "tool_use":
        summary = `Use ${subject.tool}`;
        break;
    }
    return {
      kind: "approval",
      summary:
        payload.reason !== null && summary.length === 0
          ? payload.reason
          : summary,
      decisions: payload.availableDecisions,
    };
  }
  if (payload.kind === "user_question") {
    const [question] = payload.questions;
    return {
      kind: "question",
      summary:
        payload.questions.length > 1
          ? `${payload.questions.length} questions`
          : firstLine(question?.prompt ?? "Question"),
    };
  }
  return { kind: "input", summary: "Needs your input" };
}
