// @vitest-environment jsdom

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ThreadListEntry } from "@kaioken/domain";
import type {
  ThreadSearchMatch,
  ThreadSearchResponse,
} from "@kaioken/server-contract";
import {
  useThreadSearch,
  type UseThreadSearchResult,
} from "@/hooks/queries/thread-queries";
import {
  ThreadPaletteResults,
  type ThreadPaletteNavigationItem,
} from "./ThreadPaletteResults";
import { makeThreadListEntry } from "@kaioken/test-helpers/domain-fixtures";

vi.mock("@/hooks/queries/thread-queries", () => ({
  hasThreadSearchableQuery: (value: string) =>
    value.replace(/\s/g, "").length >= 2,
  useThreadSearch: vi.fn(),
}));

vi.mock("@/hooks/queries/sidebar-navigation-query", () => ({
  useSidebarNavigation: () => ({ data: undefined, isLoading: false }),
}));

const federationState = vi.hoisted(() => ({
  remotes: [] as import("@kaioken/client-core").RemoteServerSnapshot[],
}));

vi.mock("@/hooks/queries/federation-queries", () => ({
  useFederatedRemotes: () => ({
    servers: [],
    remotes: federationState.remotes,
  }),
}));

vi.mock("@/components/thread/ThreadTitleMentions", () => ({
  useThreadTitleMentionResources: () => ({
    projectNamesById: new Map<string, string>(),
  }),
}));

const mockUseThreadSearch = vi.mocked(useThreadSearch);

function createThreadListEntry({
  id,
  title,
}: {
  id: string;
  title: string;
}): ThreadListEntry {
  return makeThreadListEntry({
    createdAt: 1000,
    id,
    lastReadAt: null,
    latestAttentionAt: 1000,
    projectId: "proj_search",
    title,
    updatedAt: 1000,
  });
}

function createSearchResponse(
  thread: ThreadListEntry,
  matches: readonly ThreadSearchMatch[] = [],
): ThreadSearchResponse {
  return {
    active: { results: [{ matches: [...matches], thread }], total: 1 },
    archived: { results: [], total: 0 },
  };
}

function mockThreadSearch(result: UseThreadSearchResult): void {
  mockUseThreadSearch.mockReturnValue(result);
}

function renderResults({
  onNavigationItemsChange = vi.fn(),
  query,
}: {
  onNavigationItemsChange?: (
    items: readonly ThreadPaletteNavigationItem[],
  ) => void;
  query: string;
}) {
  return render(
    <ThreadPaletteResults
      activeIndex={0}
      onActiveIndexChange={vi.fn()}
      onNavigationItemsChange={onNavigationItemsChange}
      onSelect={vi.fn()}
      optionIdPrefix="palette-option"
      query={query}
    />,
  );
}

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  federationState.remotes = [];
  vi.clearAllMocks();
  vi.restoreAllMocks();
});

function remoteSnapshot(
  threads: ThreadListEntry[],
): import("@kaioken/client-core").RemoteServerSnapshot {
  return {
    server: {
      handle: "mini",
      name: "Mac mini",
      url: "https://mini.kaioken.app",
      live: true,
      lastSeenAt: 1000,
      home: false,
    },
    bootstrap: {
      sections: [],
      projects: [
        {
          id: "proj_mini",
          kind: "standard",
          name: "mini repo",
          gitRemoteUrl: null,
          sources: [],
          createdAt: 0,
          updatedAt: 0,
          threads: threads.map((thread) => ({
            ...thread,
            projectId: "proj_mini",
          })),
          defaultExecutionOptions: null,
        },
      ],
      personalProject: {
        id: "proj_personal",
        kind: "personal",
        name: "Personal",
        gitRemoteUrl: null,
        sources: [],
        createdAt: 0,
        updatedAt: 0,
        threads: [],
        defaultExecutionOptions: null,
      },
    },
    fetchedAt: 1000,
    status: "live",
  };
}

describe("ThreadPaletteResults", () => {
  it("clears stale rows while the visible query is debouncing", () => {
    mockThreadSearch({
      data: createSearchResponse(
        createThreadListEntry({ id: "thr_previous", title: "Previous needle" }),
      ),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: true,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    renderResults({ query: "needle updated" });

    expect(screen.getByText("Searching threads...")).not.toBeNull();
    expect(screen.queryByRole("option")).toBeNull();
  });

  it("uses the palette option prefix for the active row", () => {
    mockThreadSearch({
      data: createSearchResponse(
        createThreadListEntry({ id: "thr_current", title: "Current needle" }),
      ),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    renderResults({ query: "needle" });

    expect(screen.getByRole("option").id).toBe(
      "palette-option-active:thr_current",
    );
  });

  it("keeps the matched message sequence in its navigation item", async () => {
    const onNavigationItemsChange = vi.fn();
    const messageMatch: ThreadSearchMatch = {
      highlightRanges: [{ start: 0, end: 6 }],
      sourceKind: "user_message",
      sourceSeq: 7,
      text: "Needle in a message",
    };
    mockThreadSearch({
      data: createSearchResponse(
        createThreadListEntry({ id: "thr_message", title: "Message match" }),
        [messageMatch],
      ),
      debouncedQuery: "needle",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    renderResults({ onNavigationItemsChange, query: "needle" });

    await waitFor(() =>
      expect(onNavigationItemsChange).toHaveBeenLastCalledWith([
        expect.objectContaining({ threadId: "thr_message", messageSeq: 7 }),
      ]),
    );
  });

  it("shows an archived overflow count", () => {
    const archivedThread = createThreadListEntry({
      id: "thr_archived",
      title: "Archived cleanup",
    });
    mockThreadSearch({
      data: {
        active: { results: [], total: 0 },
        archived: {
          results: [{ matches: [], thread: archivedThread }],
          total: 3,
        },
      },
      debouncedQuery: "cleanup",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });

    renderResults({ query: "cleanup" });

    expect(screen.getByText("Archived")).not.toBeNull();
    expect(screen.getByText("1/3")).not.toBeNull();
  });

  it("lists other Kaiokens' threads and matches their titles client-side", async () => {
    federationState.remotes = [
      remoteSnapshot([
        createThreadListEntry({
          id: "thr_mini_a",
          title: "Fix the mini build",
        }),
        createThreadListEntry({ id: "thr_mini_b", title: "Unrelated chat" }),
      ]),
    ];
    mockThreadSearch({
      data: {
        active: { results: [], total: 0 },
        archived: { results: [], total: 0 },
      },
      debouncedQuery: "mini",
      hasSearchableQuery: true,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });
    const onNavigationItemsChange = vi.fn();
    renderResults({ onNavigationItemsChange, query: "mini" });

    await waitFor(() => {
      expect(
        screen.getByRole("group", { name: "Other Kaiokens" }),
      ).toBeTruthy();
    });
    expect(screen.getByText("Fix the mini build")).toBeTruthy();
    expect(screen.queryByText("Unrelated chat")).toBeNull();
    expect(
      screen.getByText((content) => content.includes("mini repo · Mac mini")),
    ).toBeTruthy();
    expect(screen.queryByText("No matching threads")).toBeNull();
    const items = onNavigationItemsChange.mock.calls.at(
      -1,
    )?.[0] as ThreadPaletteNavigationItem[];
    expect(items).toEqual([
      expect.objectContaining({
        threadId: "mini:thr_mini_a",
        remote: { handle: "mini", threadId: "thr_mini_a" },
      }),
    ]);
  });

  it("shows other Kaiokens' recent threads before any query is typed", () => {
    federationState.remotes = [
      remoteSnapshot([
        createThreadListEntry({ id: "thr_mini_a", title: "Mini recent" }),
      ]),
    ];
    mockThreadSearch({
      data: undefined,
      debouncedQuery: "",
      hasSearchableQuery: false,
      isDebouncing: false,
      isError: false,
      isFetching: false,
      isLoading: false,
    });
    renderResults({ query: "" });
    expect(screen.getByRole("group", { name: "Other Kaiokens" })).toBeTruthy();
    expect(screen.getByText("Mini recent")).toBeTruthy();
    expect(screen.queryByText("Type to search threads.")).toBeNull();
  });
});
