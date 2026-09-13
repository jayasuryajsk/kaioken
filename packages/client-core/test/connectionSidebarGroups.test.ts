import {
  PERSONAL_PROJECT_ID,
  type Host,
  type ThreadListEntry,
} from "@kaioken/domain";
import type {
  ProjectResponse,
  ThreadSectionResponse,
} from "@kaioken/server-contract";
import {
  makeHost,
  makeThreadListEntry,
} from "@kaioken/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import { buildConnectionSidebarGroups } from "../src/sidebar/connectionSidebarGroups.js";
import { NO_MACHINE_GROUP_KEY } from "../src/sidebar/machineThreadGroups.js";

function createThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
  return makeThreadListEntry({
    id: "thr_1",
    projectId: "proj_1",
    title: "Thread",
    titleFallback: "Thread",
    lastReadAt: 0,
    latestAttentionAt: 2,
    createdAt: 1,
    updatedAt: 2,
    ...overrides,
  });
}

function createHost(id: string, name: string): Host {
  return makeHost({ id, name, createdAt: 1, updatedAt: 1 });
}

function createProject(
  id: string,
  hostIds: readonly string[],
  defaultHostId: string | null = hostIds[0] ?? null,
): ProjectResponse {
  return {
    id,
    kind: "standard",
    name: id,
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: hostIds.map((hostId, index) => ({
      id: `src_${id}_${index}`,
      projectId: id,
      type: "local_path",
      hostId,
      path: `/repos/${id}`,
      isDefault: hostId === defaultHostId,
      createdAt: 1,
      updatedAt: 1,
    })),
  };
}

function createSection(
  id: string,
  name: string,
  projectIds: string[] = [],
): ThreadSectionResponse {
  return { id, name, projectIds, createdAt: 1, updatedAt: 1 };
}

function summarize(groups: ReturnType<typeof buildConnectionSidebarGroups>) {
  return {
    sections: groups.sections.map((group) => ({
      id: group.section.id,
      projects: group.projects.map((entry) => ({
        id: entry.project.id,
        threads: entry.threads.map((thread) => thread.id),
      })),
      threads: group.threads.map((thread) => thread.id),
    })),
    machines: groups.machines.map((group) => ({
      key: group.key,
      label: group.label,
      projects: group.projects.map((entry) => ({
        id: entry.project.id,
        threads: entry.threads.map((thread) => thread.id),
      })),
    })),
    looseThreads: groups.looseThreads.map((thread) => thread.id),
  };
}

describe("buildConnectionSidebarGroups", () => {
  it("lists the primary machine first, keeps empty machines, and routes repos by source host", () => {
    const hosts = [
      createHost("host_studio", "Mac Studio"),
      createHost("host_book", "MacBook"),
      createHost("host_mini", "Mac mini"),
    ];
    const projects = [
      createProject("proj_a", ["host_book"]),
      createProject("proj_b", ["host_studio"]),
      createProject("proj_c", []),
    ];
    const threads = [
      createThread({
        id: "thr_a1",
        projectId: "proj_a",
        environmentHostId: "host_book",
      }),
      createThread({
        id: "thr_b1",
        projectId: "proj_b",
        environmentHostId: null,
      }),
      createThread({
        id: "thr_c1",
        projectId: "proj_c",
        environmentHostId: null,
      }),
      createThread({
        id: "thr_p1",
        projectId: PERSONAL_PROJECT_ID,
        environmentHostId: "host_book",
      }),
    ];

    const groups = summarize(
      buildConnectionSidebarGroups({
        hosts,
        primaryHostId: "host_book",
        projects,
        sections: [],
        threads,
      }),
    );

    expect(groups.machines).toEqual([
      {
        key: "host_book",
        label: "MacBook",
        projects: [{ id: "proj_a", threads: ["thr_a1"] }],
      },
      {
        key: "host_studio",
        label: "Mac Studio",
        projects: [{ id: "proj_b", threads: ["thr_b1"] }],
      },
      { key: "host_mini", label: "Mac mini", projects: [] },
      {
        key: NO_MACHINE_GROUP_KEY,
        label: "No machine",
        projects: [{ id: "proj_c", threads: ["thr_c1"] }],
      },
    ]);
    expect(groups.sections).toEqual([]);
    expect(groups.looseThreads).toEqual(["thr_p1"]);
  });

  it("shows a repo with sources on two machines under both, splitting threads by host", () => {
    const hosts = [
      createHost("host_book", "MacBook"),
      createHost("host_mini", "Mac mini"),
    ];
    const projects = [
      createProject("proj_a", ["host_book", "host_mini"], "host_book"),
    ];
    const threads = [
      createThread({
        id: "thr_book",
        projectId: "proj_a",
        environmentHostId: "host_book",
      }),
      createThread({
        id: "thr_mini",
        projectId: "proj_a",
        environmentHostId: "host_mini",
      }),
      createThread({
        id: "thr_none",
        projectId: "proj_a",
        environmentHostId: null,
      }),
      createThread({
        id: "thr_elsewhere",
        projectId: "proj_a",
        environmentHostId: "host_gone",
      }),
    ];

    const groups = summarize(
      buildConnectionSidebarGroups({
        hosts,
        primaryHostId: null,
        projects,
        sections: [],
        threads,
      }),
    );

    expect(groups.machines).toEqual([
      {
        key: "host_book",
        label: "MacBook",
        projects: [
          { id: "proj_a", threads: ["thr_book", "thr_none", "thr_elsewhere"] },
        ],
      },
      {
        key: "host_mini",
        label: "Mac mini",
        projects: [{ id: "proj_a", threads: ["thr_mini"] }],
      },
    ]);
  });

  it("moves labelled repos and threads under their section and out of their machine", () => {
    const hosts = [createHost("host_book", "MacBook")];
    const projects = [
      createProject("proj_a", ["host_book"]),
      createProject("proj_b", ["host_book"]),
    ];
    const sections = [
      createSection("sec_work", "Work", ["proj_a"]),
      createSection("sec_play", "Play"),
    ];
    const threads = [
      createThread({ id: "thr_a1", projectId: "proj_a", sectionId: null }),
      createThread({
        id: "thr_a2",
        projectId: "proj_a",
        sectionId: "sec_play",
      }),
      createThread({
        id: "thr_a3",
        projectId: "proj_a",
        sectionId: "sec_work",
      }),
      createThread({
        id: "thr_a3_child",
        projectId: "proj_a",
        parentThreadId: "thr_a3",
        sectionId: null,
      }),
      createThread({
        id: "thr_b1",
        projectId: "proj_b",
        sectionId: "sec_work",
      }),
      createThread({
        id: "thr_b2",
        projectId: "proj_b",
        sectionId: "sec_stale",
      }),
      createThread({
        id: "thr_p1",
        projectId: PERSONAL_PROJECT_ID,
        sectionId: "sec_play",
      }),
    ];

    const groups = summarize(
      buildConnectionSidebarGroups({
        hosts,
        primaryHostId: "host_book",
        projects,
        sections,
        threads,
      }),
    );

    expect(groups.sections).toEqual([
      {
        id: "sec_work",
        projects: [
          { id: "proj_a", threads: ["thr_a1", "thr_a3", "thr_a3_child"] },
        ],
        threads: ["thr_b1"],
      },
      { id: "sec_play", projects: [], threads: ["thr_a2", "thr_p1"] },
    ]);
    expect(groups.machines).toEqual([
      {
        key: "host_book",
        label: "MacBook",
        projects: [{ id: "proj_b", threads: ["thr_b2"] }],
      },
    ]);
    expect(groups.looseThreads).toEqual([]);
  });

  it("keeps a repo in only its first section when the server lists it twice", () => {
    const projects = [createProject("proj_a", ["host_book"])];
    const sections = [
      createSection("sec_one", "One", ["proj_a"]),
      createSection("sec_two", "Two", ["proj_a"]),
    ];

    const groups = summarize(
      buildConnectionSidebarGroups({
        hosts: [createHost("host_book", "MacBook")],
        primaryHostId: null,
        projects,
        sections,
        threads: [],
      }),
    );

    expect(
      groups.sections.map((group) => group.projects.map((entry) => entry.id)),
    ).toEqual([["proj_a"], []]);
  });
});
