// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import { MemoryRouter } from "react-router-dom";
import { TooltipProvider } from "@kaioken/shared-ui/tooltip";
import type { RemoteServerSnapshot } from "@kaioken/client-core";
import type { Host, ThreadListEntry } from "@kaioken/domain";
import type { ProjectResponse } from "@kaioken/server-contract";
import {
  makeHost,
  makeThreadListEntry,
} from "@kaioken/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  makeProjectResponse,
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { UnifiedSidebarList } from "./UnifiedSidebarList";

const hostsState = vi.hoisted(() => ({
  hosts: [] as Host[],
  primaryHostId: "host_mac",
  viewerHostId: null as string | null,
}));

const federationState = vi.hoisted(() => ({
  remotes: [] as RemoteServerSnapshot[],
}));

vi.mock("@/hooks/queries/federation-queries", () => ({
  useFederatedRemotes: () => ({
    servers: [],
    remotes: federationState.remotes,
  }),
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  selectPersistentHosts: (hosts: readonly Host[] | undefined) =>
    hosts ? [...hosts] : [],
  useHosts: () => ({ data: hostsState.hosts }),
  usePrimaryHost: () =>
    hostsState.hosts.find((host) => host.id === hostsState.primaryHostId) ??
    null,
}));

vi.mock("@/hooks/useHostDaemon", () => ({
  useHostDaemon: () => ({ localDaemonHostId: hostsState.viewerHostId }),
}));

vi.mock("@/components/thread/ThreadTitleMentions", () => ({
  useSidebarProjectName: (projectId: string | null) =>
    projectId === null || projectId === "proj_personal" ? null : projectId,
}));

vi.mock("./useThreadRowSplitDrag", () => ({
  useThreadRowSplitDrag: () => ({
    onPointerDown: undefined,
    openInSplit: () => {},
  }),
}));

vi.mock("@/components/thread/ThreadActionsMenu", () => ({
  ThreadActionsContextMenu: ({ children }: { children: React.ReactNode }) =>
    children,
  ThreadActionsMenu: () => null,
}));

vi.mock("@/components/project/ProjectActionsMenu", () => ({
  ProjectActionsContextMenu: ({ children }: { children: React.ReactNode }) =>
    children,
  ProjectActionsMenu: () => null,
}));

const NOW = Date.now();
const DAY = 24 * 60 * 60 * 1000;

function thread(overrides: Partial<ThreadListEntry> & { id: string }) {
  return makeThreadListEntry({
    projectId: "proj_a",
    title: overrides.id,
    titleFallback: overrides.id,
    lastReadAt: NOW,
    latestAttentionAt: NOW - 60_000,
    updatedAt: NOW - 60_000,
    ...overrides,
  });
}

function project(
  id: string,
  name: string,
  hostId = "host_mac",
): ProjectResponse {
  return makeProjectResponse({
    id,
    name,
    sources: [
      {
        id: `src_${id}`,
        projectId: id,
        type: "local_path",
        hostId,
        path: `/repos/${id}`,
        isDefault: true,
        createdAt: 1,
        updatedAt: 1,
      },
    ],
  });
}

const handlers = {
  onCreateThreadInSection: vi.fn(),
  onRenameSection: vi.fn(),
  onRemoveSection: vi.fn(),
  onRequestNewSection: vi.fn(),
  onNewProject: vi.fn(),
};

function renderList(
  props: Partial<React.ComponentProps<typeof UnifiedSidebarList>>,
) {
  return render(
    <JotaiProvider store={createStore()}>
      <TooltipProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <UnifiedSidebarList
              threads={[]}
              projects={[]}
              sections={[]}
              pinnedThreadIds={[]}
              draftThreadIds={new Set()}
              now={NOW}
              {...handlers}
              {...props}
            />
          </MemoryRouter>
        </QueryClientProvider>
      </TooltipProvider>
    </JotaiProvider>,
  );
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  hostsState.hosts = [];
  hostsState.viewerHostId = null;
  federationState.remotes = [];
  window.localStorage.clear();
});

function remoteSnapshot(
  overrides: Partial<RemoteServerSnapshot> & {
    handle: string;
    name: string;
  },
): RemoteServerSnapshot {
  const { handle, name, ...rest } = overrides;
  return {
    server: {
      handle,
      name,
      url: `https://${handle}.kaioken.app`,
      live: true,
      lastSeenAt: NOW - 3 * 60 * 60 * 1000,
      home: false,
    },
    bootstrap: makeSidebarBootstrapResponse({
      projects: [
        makeProjectWithThreadsResponse({
          id: "proj_remote",
          name: `${name} repo`,
          threads: [thread({ id: "thr_remote", projectId: "proj_remote" })],
        }),
      ],
      personalProject: makeProjectWithThreadsResponse({
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        threads: [
          thread({ id: "thr_remote_chat", projectId: "proj_personal" }),
        ],
      }),
    }),
    fetchedAt: NOW,
    status: "live",
    ...rest,
  };
}

describe("UnifiedSidebarList", () => {
  it("renders the default view sections in order without a priority tier", () => {
    renderList({
      projects: [project("proj_a", "alpha")],
      sections: [{ id: "sec_work", name: "work", projectIds: [] }],
      pinnedThreadIds: ["thr_pin"],
      threads: [
        thread({ id: "thr_pin", pinnedAt: 1 }),
        thread({ id: "thr_new", projectId: "proj_personal" }),
      ],
    });
    const list = screen.getByTestId("unified-sidebar-list");
    const order = [...list.querySelectorAll("section")].map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(order).toEqual([
      "unified-pinned",
      "unified-section-sec_work",
      "unified-projects",
      "unified-recents",
    ]);
    expect(screen.queryByText("Priority")).toBeNull();
    expect(screen.queryByText("Nothing needs attention")).toBeNull();
    expect(
      within(screen.getByTestId("unified-pinned")).queryByTestId(
        "timeline-row-meta",
      ),
    ).toBeNull();
  });

  it("switches to the priority view when the bell is on", () => {
    window.localStorage.setItem("kaioken.sidebar.priorityView", "true");
    renderList({
      projects: [project("proj_a", "alpha")],
      pinnedThreadIds: ["thr_pin"],
      threads: [
        thread({ id: "thr_pin", pinnedAt: 1 }),
        thread({
          id: "thr_wait",
          hasPendingInteraction: true,
          latestAttentionAt: NOW - 4 * 60_000,
        }),
        thread({ id: "thr_new", projectId: "proj_personal" }),
      ],
    });
    const list = screen.getByTestId("unified-sidebar-list");
    expect(list.getAttribute("data-sidebar-view")).toBe("priority");
    const order = [...list.querySelectorAll("section")].map((node) =>
      node.getAttribute("data-testid"),
    );
    expect(order).toEqual(["unified-priority", "unified-priority-today"]);
    expect(
      within(screen.getByTestId("unified-priority"))
        .getAllByTestId("timeline-row")
        .map((row) =>
          row
            .querySelector("[data-sidebar-thread-id]")
            ?.getAttribute("data-sidebar-thread-id"),
        ),
    ).toEqual(["thr_wait"]);
    expect(
      within(screen.getByTestId("unified-priority-today")).getAllByTestId(
        "timeline-row",
      ),
    ).toHaveLength(2);
    expect(screen.queryByTestId("unified-projects")).toBeNull();
    expect(screen.queryByTestId("needs-you-card")).toBeNull();
  });

  it("says nothing needs attention in the priority view when the list is quiet", () => {
    window.localStorage.setItem("kaioken.sidebar.priorityView", "true");
    renderList({
      projects: [],
      threads: [thread({ id: "thr_new", projectId: "proj_personal" })],
    });
    expect(screen.getByText("Nothing needs attention")).toBeTruthy();
    expect(screen.getByText("Priority")).toBeTruthy();
  });

  it("lists only projectless chats under Recents", () => {
    renderList({
      projects: [project("proj_a", "alpha")],
      threads: [
        thread({ id: "thr_project", projectId: "proj_a" }),
        thread({ id: "thr_loose", projectId: "proj_personal" }),
      ],
    });
    const recents = screen.getByTestId("unified-recents");
    expect(
      within(recents)
        .getAllByTestId("timeline-row")
        .map((row) =>
          row
            .querySelector("[data-sidebar-thread-id]")
            ?.getAttribute("data-sidebar-thread-id"),
        ),
    ).toEqual(["thr_loose"]);
  });

  it("keeps quiet projects collapsed until their folder is used", () => {
    renderList({
      projects: [project("proj_a", "alpha"), project("proj_b", "beta")],
      threads: [
        thread({ id: "thr_a", projectId: "proj_a", updatedAt: NOW - 3 * DAY }),
      ],
    });
    const projectsSection = screen.getByTestId("unified-projects");
    const alpha = within(projectsSection).getAllByTestId("unified-project")[0]!;
    expect(within(alpha).queryAllByTestId("timeline-row")).toHaveLength(0);
    expect(alpha.getAttribute("data-expanded")).toBeNull();
    fireEvent.click(
      within(alpha).getByRole("button", { name: "Expand alpha" }),
    );
    expect(within(alpha).getAllByTestId("timeline-row")).toHaveLength(1);
    expect(alpha.getAttribute("data-expanded")).toBe("true");
    expect(within(alpha).getByTestId("unified-project-threads")).toBeTruthy();
    fireEvent.click(
      within(alpha).getByRole("button", { name: "Collapse alpha" }),
    );
    expect(within(alpha).queryAllByTestId("timeline-row")).toHaveLength(0);

    fireEvent.click(
      within(projectsSection).getByRole("button", {
        name: "Collapse Projects",
      }),
    );
    expect(
      within(projectsSection).queryAllByTestId("unified-project"),
    ).toHaveLength(0);
    expect(
      within(projectsSection).getByRole("button", { name: "New project" }),
    ).toBeTruthy();
  });

  it("auto-expands the selected project and any project that needs you", () => {
    renderList({
      projects: [
        project("proj_a", "alpha"),
        project("proj_b", "beta"),
        project("proj_c", "gamma"),
      ],
      selectedProjectId: "proj_b",
      threads: [
        thread({ id: "thr_a", projectId: "proj_a", updatedAt: NOW - 3 * DAY }),
        thread({ id: "thr_b", projectId: "proj_b", updatedAt: NOW - 3 * DAY }),
        thread({
          id: "thr_c",
          projectId: "proj_c",
          hasPendingInteraction: true,
          updatedAt: NOW - 3 * DAY,
        }),
      ],
    });
    const expandedOf = (name: string) =>
      screen
        .getAllByTestId("unified-project")
        .find((node) => within(node).queryByText(name) !== null)
        ?.getAttribute("data-expanded") ?? null;
    expect(expandedOf("alpha")).toBeNull();
    expect(expandedOf("beta")).toBe("true");
    expect(expandedOf("gamma")).toBe("true");
  });

  it("opens projects with activity today and lets the user fold them", () => {
    renderList({
      projects: [project("proj_a", "alpha"), project("proj_b", "beta")],
      threads: [
        thread({ id: "thr_a", projectId: "proj_a", updatedAt: NOW - 60_000 }),
        thread({ id: "thr_b", projectId: "proj_b", updatedAt: NOW - 3 * DAY }),
      ],
    });
    const rowOf = (name: string) =>
      screen
        .getAllByTestId("unified-project")
        .find((node) => within(node).queryByText(name) !== null)!;
    expect(rowOf("alpha").getAttribute("data-expanded")).toBe("true");
    expect(rowOf("beta").getAttribute("data-expanded")).toBeNull();
    fireEvent.click(
      within(rowOf("alpha")).getByRole("button", { name: "Collapse alpha" }),
    );
    expect(rowOf("alpha").getAttribute("data-expanded")).toBeNull();
  });

  it("shows a needs-you dot and never a timestamp", () => {
    renderList({
      projects: [project("proj_a", "alpha"), project("proj_b", "beta")],
      threads: [
        thread({ id: "thr_quiet", projectId: "proj_b" }),
        thread({
          id: "thr_wait",
          projectId: "proj_a",
          hasPendingInteraction: true,
        }),
      ],
    });
    const rows = screen.getAllByTestId("unified-project-row");
    const alpha = rows.find((row) => row.textContent?.includes("alpha"))!;
    const beta = rows.find((row) => row.textContent?.includes("beta"))!;
    expect(within(alpha).getByTestId("unified-project-needs-you")).toBeTruthy();
    expect(within(alpha).queryByTestId("unified-project-activity")).toBeNull();
    expect(within(beta).queryByTestId("unified-project-needs-you")).toBeNull();
    expect(within(beta).queryByTestId("unified-project-activity")).toBeNull();
  });

  it("caps projects, per-project threads, and recents behind Show more", () => {
    const projects = Array.from({ length: 9 }, (_, index) =>
      project(`proj_${index}`, `project ${index}`),
    );
    const threads = [
      ...Array.from({ length: 4 }, (_, index) =>
        thread({
          id: `thr_p0_${index}`,
          projectId: "proj_0",
          updatedAt: NOW - index * 1000,
        }),
      ),
      ...Array.from({ length: 14 }, (_, index) =>
        thread({
          id: `thr_r_${index}`,
          projectId: "proj_personal",
          updatedAt: NOW - index * 1000,
        }),
      ),
    ];
    renderList({ projects, threads });
    const projectsSection = screen.getByTestId("unified-projects");
    expect(
      within(projectsSection).getAllByTestId("unified-project"),
    ).toHaveLength(8);
    fireEvent.click(screen.getByTestId("unified-projects-more"));
    expect(
      within(projectsSection).getAllByTestId("unified-project"),
    ).toHaveLength(9);

    const first = within(projectsSection).getAllByTestId("unified-project")[0]!;
    expect(first.getAttribute("data-expanded")).toBe("true");
    expect(within(first).getAllByTestId("timeline-row")).toHaveLength(3);
    fireEvent.click(within(first).getByTestId("unified-project-more-proj_0"));
    expect(within(first).getAllByTestId("timeline-row")).toHaveLength(4);

    const recents = screen.getByTestId("unified-recents");
    expect(within(recents).getAllByTestId("timeline-row")).toHaveLength(12);
    fireEvent.click(screen.getByTestId("unified-recents-more"));
    expect(within(recents).getAllByTestId("timeline-row")).toHaveLength(14);
  });

  it("badges only projects on other machines, never the viewer's own", () => {
    hostsState.hosts = [
      makeHost({ id: "host_mac", name: "MacBook" }),
      makeHost({ id: "host_mini", name: "Mac mini", status: "connected" }),
    ];
    hostsState.viewerHostId = "host_mac";
    renderList({
      projects: [
        project("proj_local", "local"),
        project("proj_mini", "bounty", "host_mini"),
      ],
    });
    const badgeFor = (name: string) => {
      const row = screen
        .getAllByTestId("unified-project-row")
        .find(
          (candidate) => candidate.querySelector("a")?.textContent === name,
        );
      return within(row!).getByTestId("unified-project-machine");
    };
    expect(screen.getAllByTestId("unified-project-machine")).toHaveLength(1);
    expect(
      within(
        screen
          .getAllByTestId("unified-project-row")
          .find((row) => row.querySelector("a")?.textContent === "local")!,
      ).queryByTestId("unified-project-machine"),
    ).toBeNull();
    expect(badgeFor("bounty").textContent).toBe("Mac mini");
    expect(badgeFor("bounty").querySelector(".bg-success")).not.toBeNull();
  });

  it("names every machine plainly when the local machine is unknown", () => {
    hostsState.hosts = [
      makeHost({ id: "host_mac", name: "MacBook" }),
      makeHost({ id: "host_mini", name: "Mac mini", status: "connected" }),
    ];
    renderList({
      projects: [
        project("proj_local", "local"),
        project("proj_mini", "bounty", "host_mini"),
      ],
    });
    expect(
      screen
        .getAllByTestId("unified-project-machine")
        .map((badge) => badge.textContent)
        .sort(),
    ).toEqual(["Mac mini", "MacBook"]);
  });

  it("re-sorts projects from the options menu and offers a new project", () => {
    renderList({
      projects: [project("proj_b", "beta"), project("proj_a", "alpha")],
      threads: [thread({ id: "t", projectId: "proj_b" })],
    });
    const names = () =>
      screen
        .getAllByTestId("unified-project-row")
        .map((row) => row.querySelector("a")?.textContent);
    expect(names()).toEqual(["beta", "alpha"]);
    expect(screen.getByTestId("unified-projects-sort").textContent).toBe(
      "Recent",
    );
    fireEvent.pointerDown(
      screen.getByRole("button", {
        name: "Projects options (sorted by Recent)",
      }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(names()).toEqual(["alpha", "beta"]);
    expect(screen.getByTestId("unified-projects-sort").textContent).toBe(
      "Name",
    );
    fireEvent.click(screen.getByRole("button", { name: "New project" }));
    expect(handlers.onNewProject).toHaveBeenCalled();
  });

  it("collapses a custom section and exposes its actions", () => {
    renderList({
      projects: [project("proj_a", "alpha")],
      sections: [{ id: "sec_work", name: "work", projectIds: ["proj_a"] }],
    });
    const section = screen.getByTestId("unified-section-sec_work");
    expect(within(section).getAllByTestId("unified-project")).toHaveLength(1);
    expect(screen.getByTestId("unified-projects").textContent).toContain(
      "No projects yet",
    );
    fireEvent.click(
      within(section).getByRole("button", { name: "Collapse work" }),
    );
    expect(within(section).queryAllByTestId("unified-project")).toHaveLength(0);
    fireEvent.click(
      within(section).getByRole("button", { name: "New thread in work" }),
    );
    expect(handlers.onCreateThreadInSection).toHaveBeenCalledWith("sec_work");
  });

  it("lists another Kaioken's projects and threads read-only with a server badge", () => {
    federationState.remotes = [
      remoteSnapshot({ handle: "mini", name: "Mac mini" }),
    ];
    renderList({
      projects: [project("proj_a", "alpha")],
      threads: [thread({ id: "thr_home" })],
    });
    const remoteProject = screen
      .getAllByTestId("unified-project")
      .find(
        (node) => node.getAttribute("data-project-id") === "mini:proj_remote",
      );
    expect(remoteProject).toBeDefined();
    expect(remoteProject!.getAttribute("data-remote-server")).toBe("mini");
    expect(remoteProject!.getAttribute("data-offline")).toBeNull();
    expect(
      within(remoteProject!).getByTestId("unified-project-server").textContent,
    ).toContain("Mac mini");
    expect(
      within(
        within(remoteProject!).getByTestId("unified-project-row"),
      ).queryByRole("link"),
    ).toBeNull();
    expect(
      within(remoteProject!).getByTestId("unified-remote-project-name")
        .textContent,
    ).toBe("Mac mini repo");
    const remoteRow = within(remoteProject!)
      .getAllByTestId("timeline-row")
      .find((row) => row.getAttribute("data-remote-server") === "mini");
    expect(remoteRow).toBeDefined();
    expect(remoteRow!.getAttribute("title")).toBe(
      "This thread lives on Mac mini. Actions on it are coming in the next phase.",
    );
    expect(within(remoteRow!).getByRole("link").getAttribute("href")).toBe(
      "/servers/mini/threads/thr_remote",
    );
    const recents = screen.getByTestId("unified-recents");
    const remoteChat = within(recents)
      .getAllByTestId("timeline-row")
      .find((row) => row.getAttribute("data-remote-server") === "mini");
    expect(remoteChat).toBeDefined();
    expect(
      within(remoteChat!).getByTestId("timeline-row-meta").textContent,
    ).toBe("Personal · Mac mini");
    const homeProject = screen
      .getAllByTestId("unified-project")
      .find((node) => node.getAttribute("data-project-id") === "proj_a");
    expect(homeProject!.getAttribute("data-remote-server")).toBeNull();
    expect(
      within(within(homeProject!).getByTestId("unified-project-row")).getByRole(
        "link",
      ),
    ).toBeTruthy();
  });

  it("greys out an offline Kaioken and says when it was last seen", () => {
    federationState.remotes = [
      remoteSnapshot({
        handle: "work",
        name: "Mac Studio",
        status: "offline",
        server: {
          handle: "work",
          name: "Mac Studio",
          url: "https://work.kaioken.app",
          live: false,
          lastSeenAt: NOW - 3 * 60 * 60 * 1000,
          home: false,
        },
      }),
    ];
    renderList({ projects: [], threads: [] });
    const remoteProject = screen
      .getAllByTestId("unified-project")
      .find(
        (node) => node.getAttribute("data-project-id") === "work:proj_remote",
      );
    expect(remoteProject!.getAttribute("data-offline")).toBe("true");
    expect(remoteProject!.className).not.toContain("opacity-60");
    expect(
      within(remoteProject!).getByTestId("unified-project-row").className,
    ).toContain("opacity-60");
    expect(
      within(remoteProject!).getByTestId("unified-project-server").textContent,
    ).toMatch(/^offline · last seen /);
    const remoteChat = within(screen.getByTestId("unified-recents"))
      .getAllByTestId("timeline-row")
      .find((row) => row.getAttribute("data-remote-server") === "work");
    expect(remoteChat!.getAttribute("data-offline")).toBe("true");
    expect(
      within(remoteChat!).getByTestId("timeline-row-meta").textContent,
    ).toMatch(/^offline · last seen /);
  });

  it("highlights the remote thread that is open", () => {
    federationState.remotes = [
      remoteSnapshot({ handle: "mini", name: "Mac mini" }),
    ];
    render(
      <JotaiProvider store={createStore()}>
        <TooltipProvider>
          <QueryClientProvider client={new QueryClient()}>
            <MemoryRouter
              initialEntries={["/servers/mini/threads/thr_remote_chat"]}
            >
              <UnifiedSidebarList
                threads={[]}
                projects={[]}
                sections={[]}
                pinnedThreadIds={[]}
                draftThreadIds={new Set()}
                now={NOW}
                {...handlers}
              />
            </MemoryRouter>
          </QueryClientProvider>
        </TooltipProvider>
      </JotaiProvider>,
    );
    const remoteChat = screen
      .getAllByTestId("timeline-row")
      .find((row) => row.getAttribute("data-remote-server") === "mini");
    expect(remoteChat!.className).toContain("bg-sidebar-accent");
  });
});
