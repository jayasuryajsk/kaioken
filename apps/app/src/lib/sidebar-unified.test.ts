import { describe, expect, it } from "vitest";
import type { Host, ThreadListEntry } from "@kaioken/domain";
import {
  makeHost,
  makeThreadListEntry,
} from "@kaioken/test-helpers/domain-fixtures";
import {
  buildPrioritySidebar,
  buildUnifiedSidebar,
  projectMachine,
  VIEWER_MACHINE_LABEL,
} from "./sidebar-unified";

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
  it("keeps pinned threads out of Recents and everything else in", () => {
    const waiting = thread({
      id: "thr_wait",
      projectId: "proj_personal",
      hasPendingInteraction: true,
      latestAttentionAt: NOON - 5000,
    });
    const pinned = thread({
      id: "thr_pin",
      projectId: "proj_personal",
      pinnedAt: 5,
    });
    const plain = thread({ id: "thr_plain", projectId: "proj_personal" });
    const model = build({
      threads: [waiting, pinned, plain],
      pinnedThreadIds: ["thr_pin"],
    });
    expect(model.pinned.map((entry) => entry.id)).toEqual(["thr_pin"]);
    expect(
      model.recents.flatMap((group) => group.threads.map((t) => t.id)),
    ).toEqual(["thr_wait", "thr_plain"]);
  });

  it("keeps project threads out of Recents", () => {
    const model = build({
      projects: [project("proj_a", "alpha", ["host_mac"])],
      threads: [
        thread({ id: "thr_project", projectId: "proj_a" }),
        thread({ id: "thr_loose", projectId: "proj_personal" }),
      ],
    });
    expect(
      model.recents.flatMap((group) => group.threads.map((t) => t.id)),
    ).toEqual(["thr_loose"]);
    expect(model.projects[0]!.threads.map((t) => t.id)).toEqual([
      "thr_project",
    ]);
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
      isViewer: false,
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
        thread({
          id: "today",
          projectId: "proj_personal",
          updatedAt: NOON - 1000,
        }),
        thread({
          id: "yesterday",
          projectId: "proj_personal",
          updatedAt: NOON - DAY,
        }),
        thread({
          id: "child",
          projectId: "proj_personal",
          parentThreadId: "today",
        }),
        thread({ id: "in_project", projectId: "proj_a" }),
        thread({
          id: "in_project_child",
          projectId: "proj_a",
          parentThreadId: "in_project",
        }),
      ],
    });
    expect(
      model.recents.map((g) => [g.id, g.threads.map((t) => t.id)]),
    ).toEqual([
      ["today", ["today", "child"]],
      ["yesterday", ["yesterday"]],
    ]);
    expect(model.projects[0]!.threads.map((t) => t.id)).toEqual(["in_project"]);
  });
});

describe("buildPrioritySidebar", () => {
  it("lists waiting then running threads first and the rest by day, ignoring pins", () => {
    const waiting = thread({
      id: "thr_wait",
      projectId: "proj_a",
      hasPendingInteraction: true,
      latestAttentionAt: NOON - 5000,
    });
    const running = thread({
      id: "thr_run",
      projectId: "proj_personal",
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    const pinned = thread({
      id: "thr_pin",
      projectId: "proj_a",
      pinnedAt: 5,
      updatedAt: NOON - 1000,
    });
    const old = thread({
      id: "thr_old",
      projectId: "proj_personal",
      updatedAt: NOON - 2 * DAY,
    });
    const view = buildPrioritySidebar([old, pinned, running, waiting], NOON);
    expect(view.priority.map((entry) => entry.id)).toEqual([
      "thr_wait",
      "thr_run",
    ]);
    expect(
      view.groups.map((group) => [
        group.id,
        group.threads.map((entry) => entry.id),
      ]),
    ).toEqual([
      ["today", ["thr_pin"]],
      ["this-week", ["thr_old"]],
    ]);
  });
});

describe("viewer-relative machines", () => {
  it("marks the viewer's own machine and keeps others remote", () => {
    const onMac = projectMachine(
      project("p", "p", ["host_mac"]).sources,
      [macbook, mini],
      macbook.id,
      macbook.id,
    );
    expect(onMac).toMatchObject({ isViewer: true, remote: false });
    const onMini = projectMachine(
      project("p", "p", ["host_mini"]).sources,
      [macbook, mini],
      macbook.id,
      macbook.id,
    );
    expect(onMini).toMatchObject({ isViewer: false, remote: true });
  });

  it("flips remote around when the viewer is not the hub", () => {
    const onMac = projectMachine(
      project("p", "p", ["host_mac"]).sources,
      [macbook, mini],
      macbook.id,
      mini.id,
    );
    expect(onMac).toMatchObject({
      isViewer: false,
      remote: true,
      name: "MacBook",
    });
    const onMini = projectMachine(
      project("p", "p", ["host_mini"]).sources,
      [macbook, mini],
      macbook.id,
      mini.id,
    );
    expect(onMini).toMatchObject({ isViewer: true, remote: false });
    expect(VIEWER_MACHINE_LABEL).toBe("This Mac");
  });

  it("never claims a viewer machine when the local host is unknown", () => {
    const machine = projectMachine(
      project("p", "p", ["host_mac"]).sources,
      [macbook, mini],
      macbook.id,
      null,
    );
    expect(machine).toMatchObject({ isViewer: false, remote: false });
  });

  it("prefers the viewer's checkout when a project lives on both machines", () => {
    const machine = projectMachine(
      project("p", "p", ["host_mac", "host_mini"]).sources,
      [macbook, mini],
      macbook.id,
      mini.id,
    );
    expect(machine).toMatchObject({ id: "host_mini", isViewer: true });
  });
});

describe("project needsYou", () => {
  it("flags a project holding a thread that is waiting on you", () => {
    const model = build({
      projects: [
        project("proj_a", "alpha", ["host_mac"]),
        project("proj_b", "beta", ["host_mac"]),
      ],
      threads: [
        thread({ id: "thr_quiet", projectId: "proj_b" }),
        thread({
          id: "thr_wait",
          projectId: "proj_a",
          hasPendingInteraction: true,
        }),
      ],
    });
    const byId = new Map(
      model.projects.map((group) => [group.project.id, group]),
    );
    expect(byId.get("proj_a")?.needsYou).toBe(true);
    expect(byId.get("proj_b")?.needsYou).toBe(false);
  });
});
