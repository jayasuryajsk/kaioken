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
import {
  makeHost,
  makeProviderInfo,
} from "@kaioken/test-helpers/domain-fixtures";
import { FEDERATION_MOCK_SERVERS_STORAGE_KEY } from "@/lib/federation/account-servers";
import { resetRemoteSdkForTest } from "@/lib/federation/remote-sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { makeThreadResponse } from "@/test/fixtures/thread-responses";
import { makeProjectResponse } from "@/test/fixtures/projects";
import { RemoteComposeView } from "./RemoteComposeView";

const toast = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: toast.error },
}));

vi.mock("@/components/pickers/MachinePicker", () => ({
  MachinePickerUI: (props: {
    hosts: Array<{ id: string; name: string }>;
    selectedHostId: string | null;
    onChange: (hostId: string) => void;
  }) => (
    <div data-testid="machine-picker" data-selected={props.selectedHostId}>
      {props.hosts.map((host) => (
        <button
          key={host.id}
          type="button"
          onClick={() => props.onChange(host.id)}
        >
          {host.name}
        </button>
      ))}
    </div>
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
    footerStart,
    submission,
  }: {
    value: string;
    onChange: (value: string, mentions: never[]) => void;
    onSubmit: () => void;
    footerStart?: React.ReactNode;
    submission?: { disabled?: boolean; title?: string };
  }) => (
    <div data-testid="prompt-box" data-submit-title={submission?.title}>
      {footerStart}
      <input
        aria-label="Follow-up prompt"
        value={value}
        onChange={(event) => onChange(event.target.value, [])}
      />
      <button type="button" disabled={submission?.disabled} onClick={onSubmit}>
        Submit
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
  ExecutionControls: (props: {
    provider: { selectedId?: string; options?: Array<{ value: string }> };
    model: { selected: string; onChange: (value: string) => void };
  }) => (
    <div
      data-testid="execution"
      data-provider={props.provider.selectedId}
      data-providers={props.provider.options?.map((o) => o.value).join(",")}
      data-model={props.model.selected}
    >
      <button type="button" onClick={() => props.model.onChange("gpt-5-mini")}>
        Pick mini model
      </button>
    </div>
  ),
}));

vi.mock("@/components/pickers/PermissionModePicker", () => ({
  PermissionModePicker: (props: { value?: string }) => (
    <span data-testid="permission" data-value={props.value} />
  ),
}));

vi.mock("@/views/thread-detail/ThreadTimelineScrollToBottomButton", () => ({
  ThreadTimelineScrollToBottomButton: () => null,
}));

vi.mock("@/components/thread/timeline", () => ({
  ThreadContextWindowIndicator: () => null,
}));

vi.mock("@/components/ui/bottom-anchored-scroll-body.js", () => ({
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

const MINI_BOOTSTRAP = makeSidebarBootstrapResponse({
  projects: [
    makeProjectWithThreadsResponse({
      id: "proj_mini",
      name: "mini repo",
      sources: [
        {
          id: "src_mini",
          projectId: "proj_mini",
          isDefault: true,
          createdAt: 1,
          updatedAt: 1,
          type: "local_path",
          hostId: "host_mini",
          path: "/Users/jsk/mini-repo",
        },
      ],
      defaultExecutionOptions: {
        providerId: "codex",
        model: "gpt-5",
        serviceTier: "default",
        reasoningLevel: "medium",
        permissionMode: "auto",
      },
      threads: [],
    }),
  ],
});

const HOSTS = [
  makeHost({ id: "host_mini", name: "Mac mini daemon" }),
  makeHost({ id: "host_other", name: "Build box" }),
];

const MODELS = [
  {
    id: "gpt-5",
    model: "gpt-5",
    displayName: "GPT-5",
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "medium",
    isDefault: true,
  },
  {
    id: "gpt-5-mini",
    model: "gpt-5-mini",
    displayName: "GPT-5 mini",
    description: "",
    supportedReasoningEfforts: [],
    defaultReasoningEffort: "low",
    isDefault: false,
  },
];

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

interface RemoteState {
  createStatus: number;
  requests: Array<{
    method: string;
    path: string;
    body: unknown;
    host: string;
  }>;
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
      host: url.hostname,
      body,
    });
    if (url.hostname !== "mini.kaioken.app") {
      throw new TypeError(`unexpected host ${url.hostname}`);
    }
    switch (`${method} ${url.pathname}`) {
      case "GET /api/v1/sidebar-bootstrap":
        return json(MINI_BOOTSTRAP);
      case "GET /api/v1/hosts":
        return json(HOSTS);
      case "GET /api/v1/system/execution-options":
        return json({
          providers: [
            makeProviderInfo({ id: "codex", displayName: "Codex" }),
            makeProviderInfo({ id: "claude-code", displayName: "Claude Code" }),
          ],
          permissionCeiling: "full",
          models: MODELS,
          selectedOnlyModels: [],
          modelLoadError: null,
        });
      case "POST /api/v1/threads":
        return state.createStatus === 200
          ? json(makeThreadResponse({ id: "thr_new", projectId: "proj_mini" }))
          : json({ error: "offline" }, state.createStatus);
      case "GET /api/v1/hosts/host_mini/directory":
        return json({
          directory: "/Users/jsk/code",
          parent: "/Users/jsk",
          entries: [
            { kind: "directory", name: "repo", path: "/Users/jsk/code/repo" },
          ],
        });
      case "POST /api/v1/projects":
        return json(makeProjectResponse({ id: "proj_new", name: "code" }), 201);
      default:
        return json({ error: `unhandled ${method} ${url.pathname}` }, 404);
    }
  });
}

function renderView(path = "/servers/mini/projects/proj_mini") {
  const { wrapper: Wrapper } = createQueryClientTestHarness();
  return render(
    <Wrapper>
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route
            path="/servers/:handle/projects/:projectId"
            element={<RemoteComposeView />}
          />
          <Route
            path="/servers/:handle/threads/:threadId"
            element={<div data-testid="remote-thread-route" />}
          />
        </Routes>
      </MemoryRouter>
    </Wrapper>,
  );
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
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

describe("RemoteComposeView", () => {
  it("creates the thread on the remote server with that server's machine and model", async () => {
    const state: RemoteState = { createStatus: 200, requests: [] };
    serveMini(state);
    renderView();

    await waitFor(() =>
      expect(screen.getByTestId("remote-compose-title").textContent).toBe(
        "New thread in mini repo on Mac mini",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("machine-picker").dataset.selected).toBe(
        "host_mini",
      ),
    );
    await waitFor(() =>
      expect(screen.getByTestId("execution").dataset.model).toBe("gpt-5"),
    );
    expect(screen.getByTestId("execution").dataset.providers).toBe(
      "codex,claude-code",
    );
    expect(screen.getByTestId("permission").dataset.value).toBe("auto");
    expect(
      state.requests.filter((request) => request.path === "/api/v1/hosts"),
    ).toHaveLength(1);

    fireEvent.click(screen.getByRole("button", { name: "Build box" }));
    fireEvent.click(screen.getByRole("button", { name: "Pick mini model" }));
    fireEvent.change(screen.getByLabelText("Follow-up prompt"), {
      target: { value: "start here" },
    });
    await waitFor(() =>
      expect(screen.getByTestId("execution").dataset.model).toBe("gpt-5-mini"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));

    await waitFor(() => expect(screen.getByTestId("remote-thread-route")));
    const create = state.requests.find(
      (request) =>
        request.method === "POST" && request.path === "/api/v1/threads",
    );
    expect(create?.host).toBe("mini.kaioken.app");
    expect(create?.body).toMatchObject({
      projectId: "proj_mini",
      providerId: "codex",
      model: "gpt-5-mini",
      permissionMode: "auto",
      input: [{ type: "text", text: "start here" }],
      environment: {
        type: "provider",
        environmentProviderId: "project-checkout",
        machine: { type: "existing", hostId: "host_other" },
      },
    });
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("names the server when creation fails and stays on the compose route", async () => {
    const state: RemoteState = { createStatus: 503, requests: [] };
    serveMini(state);
    renderView();
    await screen.findByLabelText("Follow-up prompt");
    await waitFor(() =>
      expect(screen.getByTestId("execution").dataset.model).toBe("gpt-5"),
    );
    fireEvent.change(screen.getByLabelText("Follow-up prompt"), {
      target: { value: "start here" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit" }));
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0]![0]).toContain("Mac mini");
    expect(screen.queryByTestId("remote-thread-route")).toBeNull();
    expect(
      (screen.getByLabelText("Follow-up prompt") as HTMLInputElement).value,
    ).toBe("start here");
  });

  it("explains a project the server does not have", async () => {
    serveMini({ createStatus: 200, requests: [] });
    renderView("/servers/mini/projects/proj_missing");
    await waitFor(() =>
      expect(
        screen.getByTestId("remote-compose-unknown-project").textContent,
      ).toContain('"proj_missing"'),
    );
    expect(screen.queryByTestId("remote-compose")).toBeNull();
  });

  it("creates a project on the remote server from its folder browser and opens it", async () => {
    const state: RemoteState = { createStatus: 200, requests: [] };
    serveMini(state);
    renderView();
    await screen.findByTestId("remote-compose");

    fireEvent.click(screen.getByTestId("remote-new-project"));
    const submit = await screen.findByRole("button", { name: "Add project" });
    await waitFor(() => expect(submit.hasAttribute("disabled")).toBe(false));
    fireEvent.click(submit);

    await waitFor(() =>
      expect(
        state.requests.find(
          (request) =>
            request.method === "POST" && request.path === "/api/v1/projects",
        )?.body,
      ).toEqual({
        name: "code",
        source: {
          type: "local_path",
          hostId: "host_mini",
          path: "/Users/jsk/code",
        },
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId("remote-compose-unknown-project").textContent,
      ).toContain('"proj_new"'),
    );
    expect(
      state.requests.some(
        (request) =>
          request.host === "mini.kaioken.app" &&
          request.path === "/api/v1/hosts/host_mini/directory",
      ),
    ).toBe(true);
  });
});
