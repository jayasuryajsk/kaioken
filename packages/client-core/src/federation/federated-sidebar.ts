import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@kaioken/domain";
import type {
  ProjectResponse,
  SidebarBootstrapResponse,
  ThreadSectionResponse,
} from "@kaioken/server-contract";

export interface FederatedServer {
  handle: string;
  name: string;
  url: string;
  live: boolean;
  lastSeenAt: number | null;
  home: boolean;
}

export type RemoteServerStatus = "live" | "offline" | "loading";

export interface RemoteServerSnapshot {
  server: FederatedServer;
  bootstrap: SidebarBootstrapResponse | null;
  fetchedAt: number | null;
  status: RemoteServerStatus;
}

export interface RemoteThreadRef {
  handle: string;
  threadId: string;
  serverName: string;
  live: boolean;
  lastSeenAt: number | null;
}

export interface RemoteProjectMachine {
  id: string;
  name: string;
  connected: boolean;
  remote: true;
  isViewer: false;
}

export interface FederatedSectionLike {
  id: string;
  name: string;
  projectIds: readonly string[];
}

export interface FederatedSidebarInputs<
  S extends FederatedSectionLike = ThreadSectionResponse,
> {
  threads: ThreadListEntry[];
  projects: ProjectResponse[];
  sections: Array<S | ThreadSectionResponse>;
  remoteThreadRefs: Map<string, RemoteThreadRef>;
  remoteProjectMachines: Map<string, RemoteProjectMachine>;
}

const REMOTE_ID_SEPARATOR = ":";

export function remoteId(handle: string, id: string): string {
  return `${handle}${REMOTE_ID_SEPARATOR}${id}`;
}

export function parseRemoteId(
  id: string,
): { handle: string; id: string } | null {
  const index = id.indexOf(REMOTE_ID_SEPARATOR);
  if (index <= 0 || index === id.length - 1) return null;
  return { handle: id.slice(0, index), id: id.slice(index + 1) };
}

function namespaceProjectId(handle: string, projectId: string): string {
  return projectId === PERSONAL_PROJECT_ID
    ? projectId
    : remoteId(handle, projectId);
}

export function namespaceRemoteThread(
  handle: string,
  thread: ThreadListEntry,
): ThreadListEntry {
  return {
    ...thread,
    id: remoteId(handle, thread.id),
    parentThreadId:
      thread.parentThreadId === null
        ? null
        : remoteId(handle, thread.parentThreadId),
    projectId: namespaceProjectId(handle, thread.projectId),
    sectionId:
      thread.sectionId === null ? null : remoteId(handle, thread.sectionId),
  };
}

export function namespaceRemoteBootstrap(
  handle: string,
  bootstrap: SidebarBootstrapResponse,
): {
  threads: ThreadListEntry[];
  projects: ProjectResponse[];
  sections: ThreadSectionResponse[];
} {
  const threads: ThreadListEntry[] = [];
  const projects: ProjectResponse[] = [];
  for (const project of bootstrap.projects) {
    const {
      threads: projectThreads,
      defaultExecutionOptions,
      ...rest
    } = project;
    void defaultExecutionOptions;
    projects.push({ ...rest, id: remoteId(handle, project.id) });
    for (const thread of projectThreads) {
      threads.push(namespaceRemoteThread(handle, thread));
    }
  }
  for (const thread of bootstrap.personalProject.threads) {
    threads.push(namespaceRemoteThread(handle, thread));
  }
  const sections = bootstrap.sections.map((section) => ({
    ...section,
    id: remoteId(handle, section.id),
    projectIds: section.projectIds.map((id) => remoteId(handle, id)),
  }));
  return { threads, projects, sections };
}

export function mergeFederatedSidebar<
  S extends FederatedSectionLike = ThreadSectionResponse,
>(args: {
  home: {
    threads: readonly ThreadListEntry[];
    projects: readonly ProjectResponse[];
    sections: readonly S[];
  };
  remotes: readonly RemoteServerSnapshot[];
}): FederatedSidebarInputs<S> {
  const threads = [...args.home.threads];
  const projects = [...args.home.projects];
  const sections: Array<S | ThreadSectionResponse> = [...args.home.sections];
  const remoteThreadRefs = new Map<string, RemoteThreadRef>();
  const remoteProjectMachines = new Map<string, RemoteProjectMachine>();
  for (const remote of args.remotes) {
    if (remote.server.home || remote.bootstrap === null) continue;
    const namespaced = namespaceRemoteBootstrap(
      remote.server.handle,
      remote.bootstrap,
    );
    const live = remote.status === "live";
    for (const thread of namespaced.threads) {
      threads.push(thread);
      remoteThreadRefs.set(thread.id, {
        handle: remote.server.handle,
        threadId: thread.id.slice(remote.server.handle.length + 1),
        serverName: remote.server.name,
        live,
        lastSeenAt: remote.server.lastSeenAt ?? remote.fetchedAt,
      });
    }
    for (const project of namespaced.projects) {
      projects.push(project);
      remoteProjectMachines.set(project.id, {
        id: remote.server.handle,
        name: remote.server.name,
        connected: live,
        remote: true,
        isViewer: false,
      });
    }
    sections.push(...namespaced.sections);
  }
  return {
    threads,
    projects,
    sections,
    remoteThreadRefs,
    remoteProjectMachines,
  };
}

export function selectRemoteServers(
  servers: readonly FederatedServer[],
): FederatedServer[] {
  return servers.filter((server) => !server.home);
}
