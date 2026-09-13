import {
  PERSONAL_PROJECT_ID,
  type Host,
  type ThreadListEntry,
} from "@kaioken/domain";
import type {
  ProjectResponse,
  ThreadSectionResponse,
} from "@kaioken/server-contract";
import { NO_MACHINE_GROUP_KEY } from "./machineThreadGroups.js";
import { createSidebarProjectIdResolver } from "./projectThreadGroups.js";

export const CONNECTION_CONTAINER_ID = "connection";

export interface ConnectionSidebarProject {
  project: ProjectResponse;
  threads: ThreadListEntry[];
}

export interface ConnectionSidebarSectionGroup {
  section: ThreadSectionResponse;
  projects: ConnectionSidebarProject[];
  threads: ThreadListEntry[];
}

export interface ConnectionSidebarMachineGroup {
  key: string;
  label: string;
  projects: ConnectionSidebarProject[];
}

export interface ConnectionSidebarGroups {
  sections: ConnectionSidebarSectionGroup[];
  machines: ConnectionSidebarMachineGroup[];
  looseThreads: ThreadListEntry[];
}

export interface BuildConnectionSidebarGroupsArgs {
  hosts: readonly Host[];
  primaryHostId: string | null;
  projects: readonly ProjectResponse[];
  sections: readonly ThreadSectionResponse[];
  threads: readonly ThreadListEntry[];
}

function projectHostIds(project: ProjectResponse): string[] {
  const hostIds: string[] = [];
  for (const source of project.sources) {
    if (!hostIds.includes(source.hostId)) {
      hostIds.push(source.hostId);
    }
  }
  return hostIds;
}

function projectDefaultHostId(project: ProjectResponse): string | null {
  const defaultSource = project.sources.find((source) => source.isDefault);
  return defaultSource?.hostId ?? project.sources[0]?.hostId ?? null;
}

function orderHosts(
  hosts: readonly Host[],
  primaryHostId: string | null,
): Host[] {
  const primary = hosts.find((host) => host.id === primaryHostId);
  if (!primary) {
    return [...hosts];
  }
  return [primary, ...hosts.filter((host) => host.id !== primary.id)];
}

export function buildConnectionSidebarGroups({
  hosts,
  primaryHostId,
  projects,
  sections,
  threads,
}: BuildConnectionSidebarGroupsArgs): ConnectionSidebarGroups {
  const sectionIds = new Set(sections.map((section) => section.id));
  const sectionIdByProjectId = new Map<string, string>();
  for (const section of sections) {
    for (const projectId of section.projectIds) {
      if (!sectionIdByProjectId.has(projectId)) {
        sectionIdByProjectId.set(projectId, section.id);
      }
    }
  }

  const threadById = new Map(threads.map((thread) => [thread.id, thread]));
  const resolveSidebarProjectId = createSidebarProjectIdResolver(threadById);
  const threadsByProjectId = new Map<string, ThreadListEntry[]>();
  const sidebarProjectIdByThreadId = new Map<string, string>();
  for (const thread of threads) {
    const projectId = resolveSidebarProjectId(thread);
    sidebarProjectIdByThreadId.set(thread.id, projectId);
    const existing = threadsByProjectId.get(projectId);
    if (existing) {
      existing.push(thread);
    } else {
      threadsByProjectId.set(projectId, [thread]);
    }
  }
  const threadSectionId = (thread: ThreadListEntry): string | null =>
    thread.sectionId !== null && sectionIds.has(thread.sectionId)
      ? thread.sectionId
      : null;

  const knownProjectIds = new Set(projects.map((project) => project.id));
  const sectionGroups: ConnectionSidebarSectionGroup[] = sections.map(
    (section) => {
      const sectionProjects = projects
        .filter(
          (project) => sectionIdByProjectId.get(project.id) === section.id,
        )
        .map((project) => ({
          project,
          threads: (threadsByProjectId.get(project.id) ?? []).filter(
            (thread) => {
              const owner = threadSectionId(thread);
              return owner === null || owner === section.id;
            },
          ),
        }));
      const sectionProjectIds = new Set(
        sectionProjects.map((entry) => entry.project.id),
      );
      const looseThreads = threads.filter(
        (thread) =>
          threadSectionId(thread) === section.id &&
          !sectionProjectIds.has(
            sidebarProjectIdByThreadId.get(thread.id) ?? "",
          ),
      );
      return { section, projects: sectionProjects, threads: looseThreads };
    },
  );

  const machineGroups = new Map<string, ConnectionSidebarMachineGroup>();
  for (const host of orderHosts(hosts, primaryHostId)) {
    machineGroups.set(host.id, {
      key: host.id,
      label: host.name,
      projects: [],
    });
  }
  const unknownHostGroups = new Map<string, ConnectionSidebarMachineGroup>();
  const noMachineGroup: ConnectionSidebarMachineGroup = {
    key: NO_MACHINE_GROUP_KEY,
    label: "No machine",
    projects: [],
  };
  const groupForHost = (hostId: string): ConnectionSidebarMachineGroup => {
    const known = machineGroups.get(hostId);
    if (known) return known;
    const unknown = unknownHostGroups.get(hostId);
    if (unknown) return unknown;
    const created = { key: hostId, label: "Unknown machine", projects: [] };
    unknownHostGroups.set(hostId, created);
    return created;
  };

  for (const project of projects) {
    if (sectionIdByProjectId.has(project.id)) continue;
    const hostIds = projectHostIds(project);
    const unlabelledThreads = (threadsByProjectId.get(project.id) ?? []).filter(
      (thread) => threadSectionId(thread) === null,
    );
    if (hostIds.length === 0) {
      noMachineGroup.projects.push({ project, threads: unlabelledThreads });
      continue;
    }
    const defaultHostId = projectDefaultHostId(project);
    const hostIdSet = new Set(hostIds);
    for (const hostId of hostIds) {
      groupForHost(hostId).projects.push({
        project,
        threads: unlabelledThreads.filter((thread) => {
          const threadHostId = thread.environmentHostId;
          if (threadHostId !== null && hostIdSet.has(threadHostId)) {
            return threadHostId === hostId;
          }
          return hostId === defaultHostId;
        }),
      });
    }
  }

  const looseThreads = threads.filter((thread) => {
    if (threadSectionId(thread) !== null) return false;
    const projectId = sidebarProjectIdByThreadId.get(thread.id) ?? "";
    return projectId === PERSONAL_PROJECT_ID || !knownProjectIds.has(projectId);
  });

  return {
    sections: sectionGroups,
    machines: [
      ...machineGroups.values(),
      ...Array.from(unknownHostGroups.keys())
        .sort((left, right) => left.localeCompare(right))
        .map((hostId) => unknownHostGroups.get(hostId)!),
      ...(noMachineGroup.projects.length > 0 ? [noMachineGroup] : []),
    ],
    looseThreads,
  };
}
