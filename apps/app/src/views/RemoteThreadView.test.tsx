// @vitest-environment jsdom

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PendingInteraction } from "@kaioken/domain";
import { FEDERATION_MOCK_SERVERS_STORAGE_KEY } from "@/lib/federation/account-servers";
import { resetRemoteSdkForTest } from "@/lib/federation/remote-sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeThreadResponse,
  makeThreadTimelineResponse,
} from "@/test/fixtures/thread-responses";
import { RemoteThreadView } from "./RemoteThreadView";

const toast = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: toast.error },
}));

vi.mock("@/components/thread/timeline/ThreadTimelineSurface", () => ({
  ThreadTimelineSurface: (props: { timelineRows: unknown[] }) => (
    <div data-testid="timeline" data-rows={props.timelineRows.length} />
  ),
}));

vi.mock("@/components/promptbox/PromptBoxInternal", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("@/components/promptbox/PromptBoxInternal")
  >()),
  PromptBoxInternal: ({
    value,
    onChange,
    onSubmit,
    submission,
    footerStart,
  }: {
    value: string;
    onChange: (value: string, mentions: never[]) => void;
    onSubmit: () => void;
    submission?: { onModifierSubmit?: () => void };
    footerStart?: React.ReactNode;
  }) => (
    <div data-testid="prompt-box">
      {footerStart}
      <input
        aria-label="Follow-up prompt"
        value={value}
        onChange={(event) => onChange(event.target.value, [])}
      />
      <button type="button" onClick={onSubmit}>
        Submit
      </button>
      <button type="button" onClick={submission?.onModifierSubmit}>
        Modifier submit
      </button>
    </div>
  ),
}));

vi.mock("@/components/promptbox/usePromptVoice", () => ({
  usePromptVoice: () => ({
    state: "idle",
    isSupported: false,
    stream: null,
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock("@/components/promptbox/ExecutionControls", () => ({
  ExecutionControls: (props: { model: { selected: string } }) => (
    <span data-testid="execution-model">{props.model.selected}</span>
  ),
}));

vi.mock("@/components/pickers/PermissionModePicker", () => ({
  PermissionModePicker: () => null,
}));

vi.mock("@/views/thread-detail/ThreadTimelineScrollToBottomButton", () => ({
  ThreadTimelineScrollToBottomButton: () => null,
}));

vi.mock("@/components/thread/timeline", () => ({
  ThreadContextWindowIndicator: () => null,
}));

vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
  BottomAnchoredScrollBody: ({
    children,
    footer,
  }: {
    children: React.ReactNode;
    footer: React.ReactNode;
  }) => (
    <div>
      {children}
      {footer}
    </div>
  ),
  useBottomAnchoredScroll: () => ({
    isAtBottom: true,
    scrollToBottom: vi.fn(),
    scrollElementIntoView: vi.fn(),
    scrollElementIntoViewClampedToMaxScroll: vi.fn(),
    captureScrollAnchor: vi.fn(),
  }),
}));

vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: () => ({ data: { keybindings: [] } }),
}));

vi.mock("@/lib/ws", () => ({
  wsManager: {
    onPluginSignal: () => () => {},
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    onChanged: () => () => {},
    onConnected: () => () => {},
    connect: vi.fn(),
  },
}));

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  readyState = 0;
  onopen: null | (() => void) = null;
  onmessage: null | ((event: unknown) => void) = null;
  onclose: null | (() => void) = null;
  onerror: null | (() => void) = null;
  close() {}
  send() {}
}

const SERVERS = {
  selfHandle: "studio",
  servers: [
    {
      handle: "studio",
      name: "MacBook",
      live: true,
      url: "https://studio.kaioken.app",
    },
    {
      handle: "mini",
      name: "Mac mini",
      live: true,
      url: "https://mini.kaioken.app",
    },
  ],
};

const APPROVAL: PendingInteraction = {
  id: "pint_1",
  threadId: "thr_mini",
  turnId: "turn_1",
  providerId: "acp",
  providerThreadId: "pt_1",
  providerRequestId: "req_1",
  status: "pending",
  statusReason: null,
  createdAt: 1,
  resolvedAt: null,
  resolution: null,
  payload: {
    kind: "approval",
    reason: null,
    availableDecisions: ["allow_once", "deny"],
    subject: {
      kind: "tool_use",
      itemId: "call_1",
      tool: "shell",
      presentation: {
        label: { pending: "Running pnpm test", completed: "Ran pnpm test" },
        icon: { glyph: "Terminal" },
        title: "pnpm test",
        detail: "Runs the mini test suite",
      },
    },
  },
};

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface RemoteState {
  pending: PendingInteraction[];
  sendStatus: number;
  requests: Array<{ method: string; path: string; body: unknown }>;
}

function serveMini(state: RemoteState) {
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const request = new Request(input, init);
    const method = request.method;
    const body = request.body === null ? undefined : await request.json();
    state.requests.push({
      method,
      path: url.pathname,
      body,
    });
    if (url.hostname !== "mini.kaioken.app") {
      throw new TypeError(`unexpected host ${url.hostname}`);
    }
    switch (`${method} ${url.pathname}`) {
      case "GET /api/v1/threads/thr_mini":
        return json(
          makeThreadResponse({
            id: "thr_mini",
            title: "Fix the mini build",
            runtime: { displayStatus: "idle" },
          }),
        );
      case "GET /api/v1/threads/thr_mini/timeline":
        return json(makeThreadTimelineResponse());
      case "GET /api/v1/threads/thr_mini/interactions":
        return json(state.pending);
      case "GET /api/v1/threads/thr_mini/default-execution-options":
        return json({
          model: "gpt-5-codex",
          serviceTier: "default",
          reasoningLevel: "medium",
          permissionMode: "default",
          source: "project",
        });
      case "POST /api/v1/threads/thr_mini/send":
        return state.sendStatus === 200
          ? json({ ok: true, delivery: "sent" })
          : json({ error: "offline" }, state.sendStatus);
      case "POST /api/v1/threads/thr_mini/interactions/pint_1/resolve":
        state.pending = [];
        return json({ ...APPROVAL, status: "resolved" });
      default:
        return json({ error: `unhandled ${method} ${url.pathname}` }, 404);
    }
  });
}

function renderView() {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <MemoryRouter initialEntries={["/servers/mini/threads/thr_mini"]}>
        <Routes>
          <Route
            path="/servers/:handle/threads/:threadId"
            element={<RemoteThreadView />}
          />
        </Routes>
      </MemoryRouter>
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubGlobal("WebSocket", FakeWebSocket);
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      disconnect() {}
      unobserve() {}
    },
  );
  window.localStorage.setItem(
    FEDERATION_MOCK_SERVERS_STORAGE_KEY,
    JSON.stringify(SERVERS),
  );
  resetRemoteSdkForTest();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  toast.error.mockReset();
  window.localStorage.clear();
});

describe("RemoteThreadView", () => {
  it("replies to a thread on another Kaioken through that server", async () => {
    const state: RemoteState = { pending: [], sendStatus: 200, requests: [] };
    serveMini(state);
    renderView();

    await waitFor(() =>
      expect(screen.getByTestId("remote-thread-title").textContent).toBe(
        "Fix the mini build",
      ),
    );
    expect(screen.getByTestId("remote-thread-marker").textContent).toContain(
      "On Mac mini",
    );
    expect(screen.queryByText(/coming in the next phase/)).toBeNull();
    await waitFor(() =>
      expect(screen.getByTestId("execution-model").textContent).toBe(
        "gpt-5-codex",
      ),
    );

    fireEvent.change(screen.getByLabelText("Follow-up prompt"), {
      target: { value: "ship it" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() =>
      expect(
        state.requests.find(
          (request) =>
            request.method === "POST" &&
            request.path === "/api/v1/threads/thr_mini/send",
        ),
      ).toBeDefined(),
    );
    const send = state.requests.find(
      (request) => request.path === "/api/v1/threads/thr_mini/send",
    )!;
    expect(send.body).toMatchObject({
      mode: "queue-if-active",
      input: [{ type: "text", text: "ship it" }],
    });
    await waitFor(() =>
      expect(
        (screen.getByLabelText("Follow-up prompt") as HTMLInputElement).value,
      ).toBe(""),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("resolves a pending approval on the remote server", async () => {
    const state: RemoteState = {
      pending: [APPROVAL],
      sendStatus: 200,
      requests: [],
    };
    serveMini(state);
    renderView();

    fireEvent.click(
      await screen.findByRole("button", { name: "Show details" }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Allow once" }));

    await waitFor(() =>
      expect(
        state.requests.find(
          (request) =>
            request.path ===
            "/api/v1/threads/thr_mini/interactions/pint_1/resolve",
        ),
      ).toBeDefined(),
    );
    const resolve = state.requests.find(
      (request) =>
        request.path === "/api/v1/threads/thr_mini/interactions/pint_1/resolve",
    )!;
    expect(resolve.method).toBe("POST");
    expect(resolve.body).toMatchObject({ decision: "allow_once" });
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "Allow once" })).toBeNull(),
    );
    expect(
      state.requests.filter((request) => request.method === "POST"),
    ).toHaveLength(1);
  });

  it("keeps the draft and names the server when it answers 503", async () => {
    const state: RemoteState = { pending: [], sendStatus: 503, requests: [] };
    serveMini(state);
    renderView();
    await screen.findByLabelText("Follow-up prompt");

    fireEvent.change(screen.getByLabelText("Follow-up prompt"), {
      target: { value: "still there?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0]![0]).toContain("Mac mini");
    expect(
      (screen.getByLabelText("Follow-up prompt") as HTMLInputElement).value,
    ).toBe("still there?");
  });

  it("explains an unknown handle instead of rendering a composer", async () => {
    fetchMock.mockImplementation(async () => json({}, 404));
    const { wrapper: Wrapper } = createQueryClientTestHarness();
    render(
      <Wrapper>
        <MemoryRouter initialEntries={["/servers/ghost/threads/thr_x"]}>
          <Routes>
            <Route
              path="/servers/:handle/threads/:threadId"
              element={<RemoteThreadView />}
            />
          </Routes>
        </MemoryRouter>
      </Wrapper>,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("remote-thread-unknown-server").textContent,
      ).toContain('"ghost"'),
    );
    expect(screen.queryByTestId("remote-thread-composer")).toBeNull();
  });
});
