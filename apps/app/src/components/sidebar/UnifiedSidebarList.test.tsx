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
import type { Host, ThreadListEntry } from "@kaioken/domain";
import type { ProjectResponse } from "@kaioken/server-contract";
import {
  makeHost,
  makeThreadListEntry,
} from "@kaioken/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeProjectResponse } from "@/test/fixtures/projects";
import { UnifiedSidebarList } from "./UnifiedSidebarList";

const hostsState = vi.hoisted(() => ({
  hosts: [] as Host[],
  primaryHostId: "host_mac",
}));

vi.mock("@/hooks/queries/host-queries", () => ({
  selectPersistentHosts: (hosts: readonly Host[] | undefined) =>
    hosts ? [...hosts] : [],
  useHosts: () => ({ data: hostsState.hosts }),
  usePrimaryHost: () =>
    hostsState.hosts.find((host) => host.id === hostsState.primaryHostId) ??
    null,
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

const interactionState = vi.hoisted(() => ({
  byThread: {} as Record<string, unknown[]>,
  resolve: vi.fn(async () => ({})),
}));

vi.mock("@/hooks/queries/thread-queries", () => ({
  useThreadPendingInteractions: (id: string) => ({
    data: interactionState.byThread[id] ?? [],
  }),
}));

vi.mock("@/hooks/mutations/thread-interaction-mutations", () => ({
  useResolveThreadPendingInteraction: () => ({
    mutateAsync: interactionState.resolve,
    isPending: false,
    error: null,
  }),
}));

function approvalInteraction(threadId: string, command: string) {
  return {
    id: `int_${threadId}`,
    threadId,
    status: "pending",
    statusReason: null,
    createdAt: 1,
    resolvedAt: null,
    turnId: "turn_1",
    providerId: "codex",
    providerThreadId: "p1",
    providerRequestId: "r1",
    resolution: null,
    payload: {
      kind: "approval",
      reason: null,
      availableDecisions: ["allow_once", "allow_for_session", "deny"],
      subject: {
        kind: "command",
        itemId: "item",
        command,
        cwd: null,
        actions: [],
        sessionGrant: null,
      },
    },
  };
}

const NOW = Date.now();

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
  interactionState.byThread = {};
  window.localStorage.clear();
});

describe("UnifiedSidebarList", () => {
  it("renders the sections in order and omits empty attention tiers", () => {
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

  it("puts approvals in Needs you as cards whose Allow resolves the interaction", () => {
    interactionState.byThread = {
      thr_wait: [approvalInteraction("thr_wait", "rm -rf dist\nnpm run build")],
    };
    renderList({
      projects: [project("proj_a", "alpha")],
      threads: [
        thread({
          id: "thr_wait",
          hasPendingInteraction: true,
          latestAttentionAt: NOW - 4 * 60_000,
        }),
        thread({
          id: "thr_run",
          status: "active",
          runtime: {
            displayStatus: "active",
            hostReconnectGraceExpiresAt: null,
          },
        }),
      ],
    });
    const order = [
      ...screen.getByTestId("unified-sidebar-list").querySelectorAll("section"),
    ].map((node) => node.getAttribute("data-testid"));
    expect(order.slice(0, 2)).toEqual(["unified-needs-you", "unified-running"]);
    const card = screen.getByTestId("needs-you-card");
    expect(within(card).getByTestId("needs-you-summary").textContent).toBe(
      "rm -rf dist",
    );
    expect(within(card).getByTestId("needs-you-wait").textContent).toBe(
      "waiting 4m",
    );
    fireEvent.click(within(card).getByRole("button", { name: "Allow" }));
    expect(interactionState.resolve).toHaveBeenCalledWith({
      threadId: "thr_wait",
      interactionId: "int_thr_wait",
      resolution: { decision: "allow_once", grantedPermissions: null },
    });
    expect(
      within(screen.getByTestId("unified-running")).getByTestId(
        "timeline-row-status",
      ).textContent,
    ).toBe("Running");
    expect(
      within(screen.getByTestId("unified-projects")).getAllByTestId(
        "timeline-row",
      ),
    ).toHaveLength(2);
    expect(screen.queryByTestId("unified-recents")).toBeNull();
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

  it("collapses the Projects section and individual projects", () => {
    renderList({
      projects: [project("proj_a", "alpha"), project("proj_b", "beta")],
      threads: [thread({ id: "thr_a", projectId: "proj_a" })],
    });
    const projectsSection = screen.getByTestId("unified-projects");
    const alpha = within(projectsSection).getAllByTestId("unified-project")[0]!;
    expect(within(alpha).getAllByTestId("timeline-row")).toHaveLength(1);
    fireEvent.click(
      within(alpha).getByRole("button", { name: "Collapse alpha" }),
    );
    expect(within(alpha).queryAllByTestId("timeline-row")).toHaveLength(0);
    expect(alpha.getAttribute("data-collapsed")).toBe("true");
    fireEvent.click(
      within(alpha).getByRole("button", { name: "Expand alpha" }),
    );
    expect(within(alpha).getAllByTestId("timeline-row")).toHaveLength(1);

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
    expect(within(first).getAllByTestId("timeline-row")).toHaveLength(3);
    fireEvent.click(within(first).getByTestId("unified-project-more-proj_0"));
    expect(within(first).getAllByTestId("timeline-row")).toHaveLength(4);

    const recents = screen.getByTestId("unified-recents");
    expect(within(recents).getAllByTestId("timeline-row")).toHaveLength(12);
    fireEvent.click(screen.getByTestId("unified-recents-more"));
    expect(within(recents).getAllByTestId("timeline-row")).toHaveLength(14);
  });

  it("shows the machine name and status on projects from another machine", () => {
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
    const rows = screen.getAllByTestId("unified-project-row");
    expect(rows).toHaveLength(2);
    const badges = screen.getAllByTestId("unified-project-machine");
    expect(badges).toHaveLength(1);
    expect(badges[0]!.textContent).toContain("Mac mini");
    expect(badges[0]!.querySelector(".bg-success")).not.toBeNull();
  });

  it("re-sorts projects from the options menu and offers a new project", () => {
    renderList({
      projects: [project("proj_b", "beta"), project("proj_a", "alpha")],
      threads: [thread({ id: "t", projectId: "proj_b" })],
    });
    const names = () =>
      screen
        .getAllByTestId("unified-project-row")
        .map((row) => row.textContent);
    expect(names()).toEqual(["beta", "alpha"]);
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Projects options" }),
      { button: 0 },
    );
    fireEvent.click(screen.getByRole("menuitemradio", { name: "Name" }));
    expect(names()).toEqual(["alpha", "beta"]);
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
});
