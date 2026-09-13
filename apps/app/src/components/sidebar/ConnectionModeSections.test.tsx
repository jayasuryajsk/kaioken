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
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@kaioken/domain";
import type {
  ProjectResponse,
  ThreadSectionResponse,
} from "@kaioken/server-contract";
import {
  makeHost,
  makeThreadListEntry,
} from "@kaioken/test-helpers/domain-fixtures";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeProjectResponse } from "@/test/fixtures/projects";
import { ConnectionModeSections } from "./ConnectionModeSections";
import { sidebarCollapsedMachinesAtom } from "./sidebarCollapsedAtoms";

const hostsState = vi.hoisted(() => ({
  hosts: [] as ReturnType<typeof makeHost>[],
  primaryHostId: null as string | null,
}));
const viewport = vi.hoisted(() => ({ compact: false }));
const mockMoveProjectToSection = vi.hoisted(() => vi.fn());
const mockMoveThreadToSection = vi.hoisted(() => vi.fn());

vi.mock("@/hooks/queries/host-queries", () => ({
  useHosts: () => ({ data: hostsState.hosts }),
  usePrimaryHost: () =>
    hostsState.hosts.find((host) => host.id === hostsState.primaryHostId) ??
    null,
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: undefined }),
}));

vi.mock("@/hooks/queries/host-path-queries", () => ({
  useHostPathExistence: () => ({}),
  isHostPathMissing: () => false,
}));

vi.mock("@/hooks/mutations/project-mutations", () => ({
  useMoveProjectToSection: () => mockMoveProjectToSection,
}));

vi.mock("@/hooks/mutations/thread-state-mutations", () => ({
  useMoveThreadToSection: () => mockMoveThreadToSection,
}));

vi.mock(
  "@kaioken/shared-ui/hooks/use-compact-viewport",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("@kaioken/shared-ui/hooks/use-compact-viewport")
    >()),
    useIsCompactViewport: () => viewport.compact,
  }),
);

vi.mock("@/hooks/useLocalPathPicker", () => ({
  usePathPickerHost: () => ({ hostId: null, hostName: null }),
}));

vi.mock("@/hooks/mutations/environment-mutations", () => ({
  useArchiveEnvironmentThreads: () => ({
    isPending: false,
    mutateAsync: vi.fn(),
    variables: undefined,
  }),
  useUpdateEnvironment: () => ({
    error: null,
    isPending: false,
    mutate: vi.fn(),
    reset: vi.fn(),
    variables: undefined,
  }),
}));

vi.mock("@/hooks/useCreateThreadInEnvironment", () => ({
  useCreateThreadInEnvironment: () => vi.fn(),
}));

vi.mock("@/hooks/usePromptDraftStorage", () => ({
  usePromptDraftHasInput: () => false,
  usePromptDraftInputThreadIds: () => new Set<string>(),
}));

vi.mock("@/components/project/ProjectActionsProvider", () => ({
  useProjectActions: () => ({
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    requestAddLocalPath: vi.fn(),
  }),
}));

vi.mock("@/components/thread/ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    renameThread: vi.fn(),
    requestRename: vi.fn(),
    requestDelete: vi.fn(),
    archiveThreadAndChildren: vi.fn(),
    unarchiveThread: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
  }),
}));

function makeThread(overrides: Partial<ThreadListEntry>): ThreadListEntry {
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

function makeProject(
  id: string,
  name: string,
  hostIds: readonly string[],
): ProjectResponse {
  return makeProjectResponse({
    id,
    name,
    sources: hostIds.map((hostId, index) => ({
      id: `src_${id}_${index}`,
      projectId: id,
      type: "local_path",
      hostId,
      path: `/repos/${id}`,
      isDefault: index === 0,
      createdAt: 1,
      updatedAt: 1,
    })),
  });
}

function makeSection(
  id: string,
  name: string,
  projectIds: string[] = [],
): ThreadSectionResponse {
  return { id, name, projectIds, createdAt: 1, updatedAt: 1 };
}

const handlers = {
  onRenameSection: vi.fn(),
  onRemoveSection: vi.fn(),
  onRequestNewSection: vi.fn(),
  onCreateProjectThread: vi.fn(),
  onCreateThreadInSection: vi.fn(),
};

function renderConnectionMode({
  projects,
  sections = [],
  threads = [],
  store = createStore(),
}: {
  projects: ProjectResponse[];
  sections?: ThreadSectionResponse[];
  threads?: ThreadListEntry[];
  store?: ReturnType<typeof createStore>;
}) {
  return render(
    <JotaiProvider store={store}>
      <TooltipProvider>
        <QueryClientProvider client={new QueryClient()}>
          <MemoryRouter>
            <ConnectionModeSections
              projects={projects}
              sections={sections}
              threads={threads}
              draftThreadIds={new Set()}
              effectivePinnedThreadIds={new Set()}
              status="ready"
              showPinnedSection={false}
              pinnedSection={{ label: "Pinned", content: null }}
              threadsSection={{ label: "Threads" }}
              collapsedSectionIds={new Set()}
              collapsedThreadIds={new Set()}
              collapsedEnvironmentIds={new Set()}
              compareThreads={() => 0}
              renderSectionDisplayOptions={() => null}
              isSectionDisplayOptionsOpen={() => false}
              onToggleCollapsed={vi.fn()}
              onToggleThreadCollapsed={vi.fn()}
              onToggleEnvironmentCollapsed={vi.fn()}
              {...handlers}
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
  hostsState.primaryHostId = null;
  viewport.compact = false;
  window.localStorage.clear();
});

describe("ConnectionModeSections", () => {
  it("groups repos under their machines, primary first, and keeps empty machines visible", () => {
    hostsState.hosts = [
      makeHost({ id: "host_studio", name: "Mac Studio" }),
      makeHost({ id: "host_book", name: "MacBook" }),
      makeHost({ id: "host_mini", name: "Mac mini" }),
    ];
    hostsState.primaryHostId = "host_book";

    renderConnectionMode({
      projects: [
        makeProject("proj_studio", "Studio repo", ["host_studio"]),
        makeProject("proj_book", "Book repo", ["host_book"]),
      ],
      threads: [
        makeThread({
          id: "thr_book",
          projectId: "proj_book",
          environmentHostId: "host_book",
        }),
        makeThread({
          id: "thr_personal",
          projectId: PERSONAL_PROJECT_ID,
          title: "Loose thread",
          titleFallback: "Loose thread",
        }),
      ],
    });

    const machineOrder = Array.from(
      document.querySelectorAll('[data-testid^="sidebar-machine-"]'),
    ).map((group) => group.getAttribute("data-testid"));
    expect(machineOrder).toEqual([
      "sidebar-machine-host_book",
      "sidebar-machine-host_studio",
      "sidebar-machine-host_mini",
    ]);
    expect(
      within(screen.getByTestId("sidebar-machine-host_book")).getByText(
        "Book repo",
      ),
    ).not.toBeNull();
    expect(
      within(screen.getByTestId("sidebar-machine-host_studio")).getByText(
        "Studio repo",
      ),
    ).not.toBeNull();
    expect(
      within(screen.getByTestId("sidebar-machine-host_mini")).getByText(
        "No repos on this machine",
      ),
    ).not.toBeNull();
    expect(screen.getByText("Loose thread")).not.toBeNull();
  });

  it("shows a labelled repo under its section instead of its machine and hides the label when empty machines collapse", () => {
    hostsState.hosts = [makeHost({ id: "host_book", name: "MacBook" })];
    hostsState.primaryHostId = "host_book";
    const store = createStore();
    store.set(sidebarCollapsedMachinesAtom, ["host_book"]);

    renderConnectionMode({
      store,
      projects: [
        makeProject("proj_work", "Work repo", ["host_book"]),
        makeProject("proj_other", "Other repo", ["host_book"]),
      ],
      sections: [makeSection("sec_work", "Work", ["proj_work"])],
      threads: [
        makeThread({
          id: "thr_work",
          projectId: "proj_work",
          title: "Work thread",
          titleFallback: "Work thread",
        }),
        makeThread({
          id: "thr_other",
          projectId: "proj_other",
          title: "Other thread",
          titleFallback: "Other thread",
          sectionId: "sec_work",
        }),
      ],
    });

    const section = screen.getByTestId("sidebar-section-sec_work");
    expect(within(section).getByText("Work repo")).not.toBeNull();
    expect(within(section).getByText("Work thread")).not.toBeNull();
    expect(within(section).getByText("Other thread")).not.toBeNull();
    expect(screen.queryByTestId("sidebar-machine-host_book")).toBeNull();
    expect(screen.queryByText("Other repo")).toBeNull();
    expect(screen.getAllByText("Work repo")).toHaveLength(1);
  });

  it("moves a repo into a section from its actions menu on compact viewports", async () => {
    viewport.compact = true;
    hostsState.hosts = [makeHost({ id: "host_book", name: "MacBook" })];
    hostsState.primaryHostId = "host_book";

    renderConnectionMode({
      projects: [makeProject("proj_work", "Work repo", ["host_book"])],
      sections: [
        makeSection("sec_work", "Work"),
        makeSection("sec_play", "Play"),
      ],
    });

    fireEvent.click(screen.getByRole("button", { name: "Work repo actions" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Move to section/ }),
    );
    const current = await screen.findByRole("menuitem", { name: /No section/ });
    expect(current.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(screen.getByRole("menuitem", { name: "Play" }));
    expect(mockMoveProjectToSection).toHaveBeenCalledWith({
      projectId: "proj_work",
      sectionId: "sec_play",
    });
  });

  it("opens the new section dialog from the repo move submenu", async () => {
    viewport.compact = true;
    hostsState.hosts = [makeHost({ id: "host_book", name: "MacBook" })];
    hostsState.primaryHostId = "host_book";

    renderConnectionMode({
      projects: [makeProject("proj_work", "Work repo", ["host_book"])],
    });

    fireEvent.click(screen.getByRole("button", { name: "Work repo actions" }));
    fireEvent.click(
      await screen.findByRole("menuitem", { name: /Move to section/ }),
    );
    fireEvent.click(
      await screen.findByRole("menuitem", { name: "New section…" }),
    );
    expect(handlers.onRequestNewSection).toHaveBeenCalledTimes(1);
  });

  it("offers section rename and removal from the section header", async () => {
    hostsState.hosts = [makeHost({ id: "host_book", name: "MacBook" })];
    renderConnectionMode({
      projects: [],
      sections: [makeSection("sec_work", "Work")],
    });

    expect(
      within(screen.getByTestId("sidebar-section-sec_work")).getByText(
        "Move repos or threads here from their menus",
      ),
    ).not.toBeNull();
    fireEvent.pointerDown(
      screen.getByRole("button", { name: "Work section actions" }),
      {
        button: 0,
      },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Remove" }));
    expect(handlers.onRemoveSection).toHaveBeenCalledWith(
      expect.objectContaining({ id: "sec_work" }),
    );
  });
});
