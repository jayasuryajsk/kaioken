import { describe, expect, it } from "vitest";
import type { Host, ThreadListEntry } from "@kaioken/domain";
import {
  makeHost,
  makeThreadListEntry,
} from "@kaioken/test-helpers/domain-fixtures";
import { buildUnifiedSidebar, projectMachine } from "./sidebar-unified";

const NOON = new Date(2026, 8, 13, 12, 0, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;

function thread(
  overrides: Partial<ThreadListEntry> & { id: string },
): ThreadListEntry {
  return makeThreadListEntry({
    projectId: "proj_a",
    lastReadAt: NOON,
    latestAttentionAt: NOON - 1000,
    updatedAt: NOON - 1000,
    ...overrides,
  });
}

function project(id: string, name: string, hostIds: string[]) {
  return {
    id,
    name,
    sources: hostIds.map((hostId, index) => ({
      id: `src_${id}_${index}`,
      projectId: id,
      type: "local_path" as const,
      hostId,
      path: `/repos/${id}`,
      isDefault: index === 0,
      createdAt: 1,
      updatedAt: 1,
    })),
  };
}

const macbook: Host = makeHost({ id: "host_mac", name: "MacBook" });
const mini: Host = makeHost({
  id: "host_mini",
  name: "Mac mini",
  status: "disconnected",
});

function build(args: Partial<Parameters<typeof buildUnifiedSidebar>[0]> = {}) {
  return buildUnifiedSidebar({
    threads: [],
    projects: [],
    sections: [],
    pinnedThreadIds: [],
    hosts: [macbook, mini],
    primaryHostId: macbook.id,
    projectsSort: "recent",
    now: NOON,
    ...args,
  });
}

describe("buildUnifiedSidebar", () => {
  it("shows a thread in exactly one of priority, pinned, or recents", () => {
    const waiting = thread({ id: "thr_wait", hasPendingInteraction: true });
    const pinned = thread({ id: "thr_pin", pinnedAt: 5 });
    const pinnedButWaiting = thread({
      id: "thr_pin_wait",
      pinnedAt: 6,
      hasPendingInteraction: true,
    });
    const plain = thread({ id: "thr_plain" });
    const model = build({
      threads: [waiting, pinned, pinnedButWaiting, plain],
      pinnedThreadIds: ["thr_pin_wait", "thr_pin"],
    });
    expect(model.priority.map((entry) => entry.id)).toEqual([
      "thr_wait",
      "thr_pin_wait",
    ]);
    expect(model.pinned.map((entry) => entry.id)).toEqual(["thr_pin"]);
    expect(
      model.recents.flatMap((group) => group.threads.map((t) => t.id)),
    ).toEqual(["thr_plain"]);
  });

  it("puts a sectioned project under its section and not under Projects", () => {
    const model = build({
      projects: [
        project("proj_a", "alpha", ["host_mac"]),
        project("proj_b", "beta", ["host_mac"]),
      ],
      sections: [{ id: "sec_work", name: "work", projectIds: ["proj_b"] }],
      threads: [
        thread({ id: "thr_a1", projectId: "proj_a" }),
        thread({ id: "thr_b1", projectId: "proj_b" }),
        thread({
          id: "thr_s1",
          projectId: "proj_personal",
          sectionId: "sec_work",
        }),
      ],
    });
    expect(model.sections).toHaveLength(1);
    expect(model.sections[0]!.projects.map((g) => g.project.id)).toEqual([
      "proj_b",
    ]);
    expect(model.sections[0]!.projects[0]!.threads.map((t) => t.id)).toEqual([
      "thr_b1",
    ]);
    expect(model.sections[0]!.threads.map((t) => t.id)).toEqual(["thr_s1"]);
    expect(model.projects.map((g) => g.project.id)).toEqual(["proj_a"]);
  });

  it("sorts projects by recent activity, name, or machine", () => {
    const projects = [
      project("proj_zed", "zed", ["host_mini"]),
      project("proj_amy", "amy", ["host_mac"]),
      project("proj_mid", "mid", ["host_mac"]),
    ];
    const threads = [
      thread({ id: "t1", projectId: "proj_mid", updatedAt: NOON - 10 }),
      thread({ id: "t2", projectId: "proj_zed", updatedAt: NOON - 5 }),
      thread({ id: "t3", projectId: "proj_mid", updatedAt: NOON - 100 }),
    ];
    const names = (sort: "recent" | "name" | "machine") =>
      build({ projects, threads, projectsSort: sort }).projects.map(
        (g) => g.project.name,
      );
    expect(names("recent")).toEqual(["zed", "mid", "amy"]);
    expect(names("name")).toEqual(["amy", "mid", "zed"]);
    expect(names("machine")).toEqual(["amy", "mid", "zed"]);
    const mid = build({ projects, threads }).projects.find(
      (g) => g.project.id === "proj_mid",
    )!;
    expect(mid.threads.map((t) => t.id)).toEqual(["t1", "t3"]);
  });

  it("labels projects on another machine with its name and status", () => {
    expect(
      projectMachine(
        project("p", "p", ["host_mini"]).sources,
        [macbook, mini],
        macbook.id,
      ),
    ).toEqual({
      id: "host_mini",
      name: "Mac mini",
      connected: false,
      remote: true,
    });
    expect(
      projectMachine(
        project("p", "p", ["host_mini", "host_mac"]).sources,
        [macbook, mini],
        macbook.id,
      ),
    ).toMatchObject({
      id: "host_mac",
      remote: false,
    });
    expect(projectMachine([], [macbook], macbook.id)).toBeNull();
  });

  it("groups recents by day and leaves child threads out of project lists", () => {
    const model = build({
      projects: [project("proj_a", "alpha", ["host_mac"])],
      threads: [
        thread({ id: "today", updatedAt: NOON - 1000 }),
        thread({ id: "yesterday", updatedAt: NOON - DAY }),
        thread({ id: "child", parentThreadId: "today" }),
      ],
    });
    expect(
      model.recents.map((g) => [g.id, g.threads.map((t) => t.id)]),
    ).toEqual([
      ["today", ["today", "child"]],
      ["yesterday", ["yesterday"]],
    ]);
    expect(model.projects[0]!.threads.map((t) => t.id)).toEqual([
      "today",
      "yesterday",
    ]);
  });
});
