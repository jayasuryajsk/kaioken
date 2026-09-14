import { PERSONAL_PROJECT_ID } from "@kaioken/domain";
import type {
  ProjectResponse,
  SidebarBootstrapResponse,
  ThreadSectionResponse,
} from "@kaioken/server-contract";
import { makeThreadListEntry } from "@kaioken/test-helpers/domain-fixtures";
import { describe, expect, it } from "vitest";
import {
  mergeFederatedSidebar,
  namespaceRemoteThread,
  parseRemoteId,
  remoteId,
  type FederatedServer,
  type RemoteServerSnapshot,
} from "../src/federation/federated-sidebar.js";

function project(id: string, name: string): ProjectResponse {
  return {
    id,
    kind: "standard",
    name,
    gitRemoteUrl: null,
    createdAt: 1,
    updatedAt: 1,
    sources: [],
  } as ProjectResponse;
}

function section(id: string, projectIds: string[]): ThreadSectionResponse {
  return { id, name: id, projectIds, createdAt: 1, updatedAt: 1 };
}

function bootstrap(args: {
  projectId: string;
  threadIds: string[];
  personalThreadIds?: string[];
  sections?: ThreadSectionResponse[];
}): SidebarBootstrapResponse {
  return {
    sections: args.sections ?? [],
    projects: [
      {
        ...project(args.projectId, args.projectId),
        defaultExecutionOptions: null,
        threads: args.threadIds.map((id) =>
          makeThreadListEntry({ id, projectId: args.projectId }),
        ),
      },
    ],
    personalProject: {
      ...project(PERSONAL_PROJECT_ID, "Personal"),
      defaultExecutionOptions: null,
      threads: (args.personalThreadIds ?? []).map((id) =>
        makeThreadListEntry({ id, projectId: PERSONAL_PROJECT_ID }),
      ),
    },
  } as SidebarBootstrapResponse;
}

function server(handle: string, overrides: Partial<FederatedServer> = {}) {
  return {
    handle,
    name: handle,
    url: `https://${handle}.kaioken.app`,
    live: true,
    lastSeenAt: null,
    home: false,
    ...overrides,
  } satisfies FederatedServer;
}

describe("remote ids", () => {
  it("namespaces and parses ids without colliding with plain ones", () => {
    expect(remoteId("mini", "thr_1")).toBe("mini:thr_1");
    expect(parseRemoteId("mini:thr_1")).toEqual({
      handle: "mini",
      id: "thr_1",
    });
    expect(parseRemoteId("thr_1")).toBeNull();
    expect(parseRemoteId(":thr_1")).toBeNull();
    expect(parseRemoteId("mini:")).toBeNull();
  });

  it("keeps the personal project id shared and namespaces parents and sections", () => {
    const thread = namespaceRemoteThread(
      "mini",
      makeThreadListEntry({
        id: "thr_child",
        parentThreadId: "thr_parent",
        projectId: PERSONAL_PROJECT_ID,
        sectionId: "sec_1",
      }),
    );
    expect(thread.id).toBe("mini:thr_child");
    expect(thread.parentThreadId).toBe("mini:thr_parent");
    expect(thread.projectId).toBe(PERSONAL_PROJECT_ID);
    expect(thread.sectionId).toBe("mini:sec_1");
  });
});

describe("mergeFederatedSidebar", () => {
  const home = {
    threads: [makeThreadListEntry({ id: "thr_home", projectId: "proj_a" })],
    projects: [project("proj_a", "alpha")],
    sections: [section("sec_home", ["proj_a"])],
  };

  it("appends namespaced remote rows and records their server", () => {
    const remotes: RemoteServerSnapshot[] = [
      {
        server: server("mini", { name: "Mac mini" }),
        bootstrap: bootstrap({
          projectId: "proj_a",
          threadIds: ["thr_home"],
          personalThreadIds: ["thr_p"],
          sections: [section("sec_work", ["proj_a"])],
        }),
        fetchedAt: 50,
        status: "live",
      },
    ];
    const merged = mergeFederatedSidebar({ home, remotes });
    expect(merged.threads.map((t) => t.id)).toEqual([
      "thr_home",
      "mini:thr_home",
      "mini:thr_p",
    ]);
    expect(merged.projects.map((p) => p.id)).toEqual(["proj_a", "mini:proj_a"]);
    expect(merged.sections.map((s) => [s.id, s.projectIds])).toEqual([
      ["sec_home", ["proj_a"]],
      ["mini:sec_work", ["mini:proj_a"]],
    ]);
    expect(merged.remoteThreadRefs.get("mini:thr_home")).toEqual({
      handle: "mini",
      threadId: "thr_home",
      serverName: "Mac mini",
      live: true,
      lastSeenAt: 50,
    });
    expect(merged.remoteProjectMachines.get("mini:proj_a")).toMatchObject({
      id: "mini",
      name: "Mac mini",
      connected: true,
      remote: true,
    });
    expect(merged.remoteThreadRefs.has("thr_home")).toBe(false);
  });

  it("keeps an offline server's snapshot but marks it disconnected", () => {
    const merged = mergeFederatedSidebar({
      home,
      remotes: [
        {
          server: server("studio", { live: false, lastSeenAt: 7 }),
          bootstrap: bootstrap({ projectId: "proj_s", threadIds: ["thr_s"] }),
          fetchedAt: 9,
          status: "offline",
        },
      ],
    });
    expect(merged.remoteThreadRefs.get("studio:thr_s")).toMatchObject({
      live: false,
      lastSeenAt: 7,
    });
    expect(merged.remoteProjectMachines.get("studio:proj_s")?.connected).toBe(
      false,
    );
  });

  it("skips the home server and servers with no snapshot yet", () => {
    const merged = mergeFederatedSidebar({
      home,
      remotes: [
        {
          server: server("studio", { home: true }),
          bootstrap: bootstrap({ projectId: "proj_x", threadIds: ["thr_x"] }),
          fetchedAt: 1,
          status: "live",
        },
        {
          server: server("mini"),
          bootstrap: null,
          fetchedAt: null,
          status: "loading",
        },
      ],
    });
    expect(merged.threads).toHaveLength(1);
    expect(merged.projects).toHaveLength(1);
    expect(merged.remoteThreadRefs.size).toBe(0);
  });
});
