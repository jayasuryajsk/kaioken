// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { CompactViewportOverrideProvider } from "@kaioken/shared-ui/hooks/use-compact-viewport";
import type { CodexThreadLinkResponse } from "@kaioken/server-contract";
import { afterEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "../../../.ladle/story-fixtures";
import { sdk } from "@/lib/sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { ThreadActionsMenu } from "./ThreadActionsMenu";
import { ThreadSectionMoveProvider } from "./ThreadSectionMoveProvider";

const appToast = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  message: vi.fn(),
  warning: vi.fn(),
  loading: vi.fn(),
  dismiss: vi.fn(),
}));
const copyToClipboardWithToast = vi.hoisted(() => vi.fn());

vi.mock("@/lib/sdk", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/lib/sdk")>();
  return {
    ...original,
    sdk: {
      threads: {
        codex: { link: vi.fn(), handoff: vi.fn(), sync: vi.fn() },
      },
    },
  };
});

vi.mock("@/components/ui/app-toast", () => ({ appToast }));
vi.mock("@/lib/clipboard", () => ({ copyToClipboardWithToast }));
vi.mock("./ThreadActionsProvider", () => ({
  useThreadActions: () => ({
    archiveThreadAndChildren: vi.fn(),
    requestDelete: vi.fn(),
    requestRename: vi.fn(),
    togglePin: vi.fn(),
    toggleRead: vi.fn(),
    unarchiveThread: vi.fn(),
    renameThread: vi.fn(),
  }),
}));

const linkMock = vi.mocked(sdk.threads.codex.link);
const handoffMock = vi.mocked(sdk.threads.codex.handoff);
const syncMock = vi.mocked(sdk.threads.codex.sync);

function link(
  overrides: Partial<CodexThreadLinkResponse> = {},
): CodexThreadLinkResponse {
  return {
    threadId: "thread-1",
    providerThreadId: "019e-codex",
    sourceProviderThreadId: "019e-codex",
    handoffState: null,
    sourceSyncedOrdinal: 4,
    ...overrides,
  };
}

function renderMenu(providerId = "codex") {
  const harness = createQueryClientTestHarness();
  const thread = makeThreadListEntry({
    id: "thread-1",
    providerId,
    pinnedAt: null,
    sectionId: null,
  });
  render(
    <CompactViewportOverrideProvider isCompactViewport={false}>
      <ThreadSectionMoveProvider destinations={[]}>
        <ThreadActionsMenu thread={thread} />
      </ThreadSectionMoveProvider>
    </CompactViewportOverrideProvider>,
    { wrapper: harness.wrapper },
  );
  fireEvent.pointerDown(
    screen.getByRole("button", { name: "Thread actions" }),
    {
      button: 0,
    },
  );
}

afterEach(() => {
  cleanup();
  linkMock.mockReset();
  handoffMock.mockReset();
  syncMock.mockReset();
  appToast.success.mockReset();
  copyToClipboardWithToast.mockReset();
});

describe("ThreadCodexActions", () => {
  it("stays hidden for threads on other providers without asking the server", async () => {
    renderMenu("claude");
    await screen.findByRole("menuitem", { name: "Copy thread link" });
    expect(
      screen.queryByRole("menuitem", { name: "Continue in Codex" }),
    ).toBeNull();
    expect(linkMock).not.toHaveBeenCalled();
  });

  it("stays hidden for Codex threads that have no session yet", async () => {
    linkMock.mockResolvedValue(link({ providerThreadId: null }));
    renderMenu();
    await waitFor(() => expect(linkMock).toHaveBeenCalled());
    await screen.findByRole("menuitem", { name: "Copy thread link" });
    expect(
      screen.queryByRole("menuitem", { name: "Continue in Codex" }),
    ).toBeNull();
  });

  it("hands off and toasts the resume command with a copy action", async () => {
    linkMock.mockResolvedValue(link());
    handoffMock.mockResolvedValue({
      threadId: "thread-1",
      providerThreadId: "019e-codex",
      rolloutPath: "/Users/me/.codex/sessions/2026/06/12/rollout.jsonl",
      command: "codex resume 019e-codex",
      hostId: "host-local",
      hostName: "MacBook",
      hostIsServer: true,
    });
    renderMenu();

    const item = await screen.findByRole("menuitem", {
      name: "Continue in Codex",
    });
    expect(
      screen.queryByRole("menuitem", { name: "Sync from Codex" }),
    ).toBeNull();
    fireEvent.click(item);

    await waitFor(() => expect(appToast.success).toHaveBeenCalled());
    const [title, options] = appToast.success.mock.calls[0]!;
    expect(title).toBe("Ready to continue in Codex");
    expect(options.description).toBe("codex resume 019e-codex");
    options.action.onClick();
    expect(copyToClipboardWithToast).toHaveBeenCalledWith(
      "codex resume 019e-codex",
      expect.objectContaining({ successMessage: "Command copied" }),
    );
    expect(handoffMock).toHaveBeenCalledWith({ threadId: "thread-1" });
  });

  it("offers sync only after a handoff and reports the pulled turns", async () => {
    linkMock.mockResolvedValue(link({ handoffState: "handed-off" }));
    syncMock.mockResolvedValue({
      threadId: "thread-1",
      providerThreadId: "019e-codex",
      rolloutPath: "/Users/me/.codex/sessions/2026/06/12/rollout.jsonl",
      appendedTurns: 2,
      appendedEvents: 7,
    });
    renderMenu();

    fireEvent.click(
      await screen.findByRole("menuitem", { name: "Sync from Codex" }),
    );

    await waitFor(() =>
      expect(appToast.success).toHaveBeenCalledWith(
        "Pulled 2 turns from Codex",
      ),
    );
    expect(syncMock).toHaveBeenCalledWith({ threadId: "thread-1" });
  });
});
