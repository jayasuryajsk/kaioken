import { describe, expect, it } from "vitest";
import type { Host, ThreadListEntry } from "@kaioken/domain";
import {
  makeHost,
  makeThreadListEntry,
} from "@kaioken/test-helpers/domain-fixtures";
import {
  buildUnifiedSidebar,
  describeNeedsYouRequest,
  describeRunningThread,
  formatWaitDuration,
  projectMachine,
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
  it("shows a thread in exactly one of needs you, running, pinned, or recents", () => {
    const waiting = thread({
      id: "thr_wait",
      projectId: "proj_personal",
      hasPendingInteraction: true,
      latestAttentionAt: NOON - 5000,
    });
    const waitingLonger = thread({
      id: "thr_wait_longer",
      projectId: "proj_personal",
      hasPendingInteraction: true,
      latestAttentionAt: NOON - 9000,
    });
    const running = thread({
      id: "thr_run",
      projectId: "proj_personal",
      status: "active",
      runtime: { displayStatus: "active", hostReconnectGraceExpiresAt: null },
    });
    const pinned = thread({
      id: "thr_pin",
      projectId: "proj_personal",
      pinnedAt: 5,
    });
    const pinnedButWaiting = thread({
      id: "thr_pin_wait",
      projectId: "proj_personal",
      pinnedAt: 6,
      hasPendingInteraction: true,
      latestAttentionAt: NOON - 1000,
    });
    const plain = thread({ id: "thr_plain", projectId: "proj_personal" });
    const model = build({
      threads: [
        waiting,
        waitingLonger,
        running,
        pinned,
        pinnedButWaiting,
        plain,
      ],
      pinnedThreadIds: ["thr_pin_wait", "thr_pin"],
    });
    expect(model.needsYou.map((entry) => entry.id)).toEqual([
      "thr_wait_longer",
      "thr_wait",
      "thr_pin_wait",
    ]);
    expect(model.running.map((entry) => entry.id)).toEqual(["thr_run"]);
    expect(model.pinned.map((entry) => entry.id)).toEqual(["thr_pin"]);
    expect(
      model.recents.flatMap((group) => group.threads.map((t) => t.id)),
    ).toEqual(["thr_plain"]);
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

describe("attention tier descriptions", () => {
  it("formats wait times and running states", () => {
    expect(formatWaitDuration(30_000)).toBe("waiting now");
    expect(formatWaitDuration(4 * 60_000)).toBe("waiting 4m");
    expect(formatWaitDuration(3 * 60 * 60_000)).toBe("waiting 3h");
    expect(formatWaitDuration(2 * DAY)).toBe("waiting 2d");
    expect(
      describeRunningThread(thread({ id: "q", queuedWork: "waiting" })),
    ).toBe("Queued");
    expect(
      describeRunningThread(
        thread({
          id: "p",
          runtime: {
            displayStatus: "provisioning",
            hostReconnectGraceExpiresAt: null,
          },
        }),
      ),
    ).toBe("Provisioning");
  });

  it("summarises approvals and questions for the card", () => {
    const base = {
      id: "int_1",
      threadId: "thr_1",
      status: "pending" as const,
      statusReason: null,
      createdAt: 1,
      resolvedAt: null,
      turnId: "turn_1",
      providerId: "codex",
      providerThreadId: "p1",
      providerRequestId: "r1",
      resolution: null,
    };
    expect(
      describeNeedsYouRequest({
        ...base,
        payload: {
          kind: "approval",
          reason: null,
          availableDecisions: ["allow_once", "deny"],
          subject: {
            kind: "command",
            itemId: "i",
            command: "ls -la\necho done",
            cwd: null,
            actions: [],
            sessionGrant: null,
          },
        },
      }),
    ).toEqual({
      kind: "approval",
      summary: "ls -la",
      decisions: ["allow_once", "deny"],
    });
    expect(
      describeNeedsYouRequest({
        ...base,
        payload: {
          kind: "user_question",
          questions: [
            {
              id: "q1",
              prompt: "Which branch?",
              allowFreeText: true,
              multiSelect: false,
            },
          ],
        },
      }),
    ).toMatchObject({ kind: "question", summary: "Which branch?" });
  });
});
