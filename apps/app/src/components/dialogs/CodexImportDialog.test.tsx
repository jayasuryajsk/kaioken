// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { CodexSession } from "@kaioken/server-contract";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { MemoryRouter, useLocation } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { CodexImportDialog, groupCodexSessions } from "./CodexImportDialog";

vi.mock("@/lib/sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...original,
    sdk: {
      codex: { sessions: { list: vi.fn(), import: vi.fn() } },
    },
  };
});

const NOW = Date.now();

function session(
  overrides: Partial<CodexSession> & { id: string },
): CodexSession {
  return {
    path: `/home/me/.codex/sessions/${overrides.id}.jsonl`,
    cwd: "/Users/me/kaioken",
    originator: "codex_cli_rs",
    source: "cli",
    createdAt: null,
    updatedAt: NOW - 60_000,
    firstPrompt: "Fix the flaky test",
    archived: false,
    importedThreadId: null,
    ...overrides,
  };
}

const listMock = vi.mocked(sdk.codex.sessions.list);
const importMock = vi.mocked(sdk.codex.sessions.import);

function LocationProbe() {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}</div>;
}

function renderDialog() {
  const harness = createQueryClientTestHarness();
  const onOpenChange = vi.fn();
  render(
    <MemoryRouter initialEntries={["/"]}>
      <CodexImportDialog open onOpenChange={onOpenChange} />
      <LocationProbe />
    </MemoryRouter>,
    { wrapper: harness.wrapper },
  );
  return { onOpenChange };
}

afterEach(() => {
  cleanup();
  listMock.mockReset();
  importMock.mockReset();
});

describe("groupCodexSessions", () => {
  it("groups by folder, newest group and session first, and filters by query", () => {
    const groups = groupCodexSessions(
      [
        session({ id: "a", cwd: "/repo/one", updatedAt: 10 }),
        session({
          id: "b",
          cwd: "/repo/two",
          updatedAt: 30,
          firstPrompt: "Ship it",
        }),
        session({ id: "c", cwd: "/repo/one", updatedAt: 20 }),
      ],
      "",
    );
    expect(groups.map((group) => group.name)).toEqual(["two", "one"]);
    expect(groups[1]!.sessions.map((entry) => entry.id)).toEqual(["c", "a"]);
    expect(
      groupCodexSessions(
        [session({ id: "a" }), session({ id: "b", firstPrompt: "Ship it" })],
        "ship",
      ).flatMap((group) => group.sessions.map((entry) => entry.id)),
    ).toEqual(["b"]);
  });
});

describe("CodexImportDialog", () => {
  it("lists sessions grouped by folder with imported markers", async () => {
    listMock.mockResolvedValue({
      sessions: [
        session({ id: "s1", cwd: "/Users/me/kaioken" }),
        session({
          id: "s2",
          cwd: "/Users/me/other",
          firstPrompt: "Write docs",
          importedThreadId: "thr_existing",
        }),
      ],
      sharedHome: "/Users/me/.codex",
      privateHome: "/Users/me/.kaioken/codex-home",
    });
    renderDialog();

    const kaioken = await screen.findByRole("region", { name: "kaioken" });
    expect(within(kaioken).getByText("Fix the flaky test")).toBeTruthy();
    const other = screen.getByRole("region", { name: "other" });
    expect(within(other).getByText("Write docs")).toBeTruthy();
    expect(within(other).getByText("Imported")).toBeTruthy();
    expect(listMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ includeArchived: false }),
    );
  });

  it("refetches with archived sessions when the toggle is switched on", async () => {
    listMock.mockResolvedValue({
      sessions: [],
      sharedHome: "/Users/me/.codex",
      privateHome: "/Users/me/.kaioken/codex-home",
    });
    renderDialog();
    expect(
      await screen.findByText("No Codex sessions found in ~/.codex/sessions"),
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("switch", { name: "Show archived" }));

    await waitFor(() => {
      expect(listMock).toHaveBeenLastCalledWith(
        expect.objectContaining({ includeArchived: true }),
      );
    });
  });

  it("imports the chosen session and opens the new thread", async () => {
    listMock.mockResolvedValue({
      sessions: [session({ id: "s1" })],
      sharedHome: "/Users/me/.codex",
      privateHome: "/Users/me/.kaioken/codex-home",
    });
    importMock.mockResolvedValue(
      makeThreadResponse({ id: "thr_new", projectId: "proj_1" }),
    );
    const { onOpenChange } = renderDialog();

    fireEvent.click(
      await screen.findByRole("button", { name: /Fix the flaky test/ }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("location").textContent).toBe(
        "/projects/proj_1/threads/thr_new",
      );
    });
    expect(importMock).toHaveBeenCalledWith({ id: "s1", origin: "app" });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("shows the error and retries", async () => {
    listMock.mockRejectedValueOnce(new Error("codex home unreadable"));
    listMock.mockResolvedValue({
      sessions: [session({ id: "s1" })],
      sharedHome: "/Users/me/.codex",
      privateHome: "/Users/me/.kaioken/codex-home",
    });
    renderDialog();

    expect(await screen.findByText("codex home unreadable")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(await screen.findByText("Fix the flaky test")).toBeTruthy();
  });
});
