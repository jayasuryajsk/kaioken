// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import type { Host, ThreadListEntry } from "@kaioken/domain";
import {
  makeHost,
  makeThreadListEntry,
} from "@kaioken/test-helpers/domain-fixtures";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { TimelineThreadList } from "./TimelineThreadList";

const hostsState = vi.hoisted(() => ({
  hosts: [] as Host[],
  primaryHostId: "host_macbook",
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
    projectId === "proj_kali"
      ? "kali"
      : projectId === null || projectId === "proj_personal"
        ? null
        : "telescope",
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

const NOW = Date.now();

function entry(overrides: Partial<ThreadListEntry> & { id: string }) {
  return makeThreadListEntry({
    projectId: "proj_kali",
    updatedAt: NOW - 60_000,
    latestAttentionAt: NOW - 60_000,
    lastReadAt: NOW,
    ...overrides,
  });
}

function renderList(threads: ThreadListEntry[]) {
  const harness = createQueryClientTestHarness();
  render(
    <MemoryRouter>
      <TimelineThreadList
        draftThreadIds={new Set()}
        threads={threads}
        selectedThreadId={undefined}
      />
    </MemoryRouter>,
    { wrapper: harness.wrapper },
  );
}

afterEach(() => {
  cleanup();
  hostsState.hosts = [];
});

describe("TimelineThreadList", () => {
  it("always shows Priority first and says when nothing needs attention", () => {
    renderList([entry({ id: "thr_a" })]);
    const priority = screen.getByTestId("timeline-group-priority");
    expect(within(priority).getByText("Nothing needs attention")).toBeTruthy();
    const today = screen.getByTestId("timeline-group-today");
    expect(within(today).getAllByTestId("timeline-row")).toHaveLength(1);
    expect(
      priority.compareDocumentPosition(today) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /need you/u })).toBeNull();
  });

  it("moves threads that need you into Priority instead of the day group", () => {
    renderList([
      entry({ id: "thr_wait", hasPendingInteraction: true }),
      entry({ id: "thr_idle" }),
    ]);
    const priority = screen.getByTestId("timeline-group-priority");
    expect(within(priority).getAllByTestId("timeline-row")).toHaveLength(1);
    expect(
      within(screen.getByTestId("timeline-group-today")).getAllByTestId(
        "timeline-row",
      ),
    ).toHaveLength(1);
  });

  it("labels rows with the repo and the machine when it is not the server", () => {
    hostsState.hosts = [
      makeHost({ id: "host_macbook", name: "MacBook" }),
      makeHost({ id: "host_mini", name: "Mac mini" }),
    ];
    renderList([
      entry({ id: "thr_local", environmentHostId: "host_macbook" }),
      entry({ id: "thr_remote", environmentHostId: "host_mini" }),
      entry({
        id: "thr_personal",
        projectId: "proj_personal",
        environmentHostId: "host_mini",
      }),
    ]);
    const metas = screen
      .getAllByTestId("timeline-row-meta")
      .map((node) => node.textContent);
    expect(metas).toEqual(["kali", "kali · Mac mini", "Mac mini"]);
  });
});
