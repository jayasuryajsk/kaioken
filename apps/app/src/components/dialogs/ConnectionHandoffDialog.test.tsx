// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { sdk } from "@/lib/sdk";
import { requestConnectionHandoff } from "@/lib/federation/handoff-request";
import { ConnectionHandoffDialogHost } from "./ConnectionHandoffDialog";

vi.mock("@/lib/sdk", () => ({
  sdk: {
    experimental_connections: {
      resolve: vi.fn(),
      handoffs: {
        preview: vi.fn(),
        start: vi.fn(),
        get: vi.fn(),
        retry: vi.fn(),
        cancel: vi.fn(),
      },
    },
  },
}));
vi.mock("@/hooks/queries/federation-queries", () => ({
  useConnectedComputers: () => [
    {
      handle: "ssh.work",
      name: "Work computer",
      live: true,
      home: false,
      url: "http://127.0.0.1:49000",
    },
  ],
}));
vi.mock("@/lib/federation/connection-identities", () => ({
  readConnectionIdentity: () => null,
  rememberConnectionIdentity: vi.fn(),
}));
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.resetAllMocks();
});

it("previews a matching project and recovers an uncertain start after reload with the same operation identity", async () => {
  const { wrapper } = createQueryClientTestHarness();
  vi.mocked(sdk.experimental_connections.resolve).mockImplementation(
    async ({ handle }) => ({
      serverId:
        handle === null
          ? "a0000000-0000-4000-8000-000000000001"
          : "b0000000-0000-4000-8000-000000000002",
      primaryHostId: "host",
      workspaceProtocol: 1,
    }),
  );
  vi.mocked(sdk.experimental_connections.handoffs.preview).mockResolvedValue({
    repository: { remotes: ["example.test/org/repo"], subdirectory: "" },
    projects: [
      {
        id: "destination-project",
        name: "Matching project",
        hostId: "host",
        path: "/projects/repo",
      },
    ],
  });
  vi.mocked(sdk.experimental_connections.handoffs.start).mockRejectedValue(
    new Error("Connection dropped"),
  );
  const rendered = render(
    <MemoryRouter>
      <ConnectionHandoffDialogHost />
    </MemoryRouter>,
    { wrapper },
  );
  act(() =>
    requestConnectionHandoff({ handle: null, threadId: "source-task" }),
  );
  fireEvent.click(await screen.findByRole("button", { name: "Work computer" }));
  await screen.findByText("Matching project");
  await waitFor(() =>
    expect(
      screen
        .getByRole("button", { name: "Move task" })
        .hasAttribute("disabled"),
    ).toBe(false),
  );
  expect(sdk.experimental_connections.handoffs.start).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Move task" }));
  await screen.findByText("Connection dropped");
  rendered.unmount();
  const recovered = createQueryClientTestHarness();
  render(
    <MemoryRouter>
      <ConnectionHandoffDialogHost />
    </MemoryRouter>,
    { wrapper: recovered.wrapper },
  );
  fireEvent.click(await screen.findByRole("button", { name: "Task handoff" }));
  fireEvent.click(await screen.findByRole("button", { name: "Retry" }));
  await waitFor(() =>
    expect(sdk.experimental_connections.handoffs.start).toHaveBeenCalledTimes(
      2,
    ),
  );
  const calls = vi.mocked(sdk.experimental_connections.handoffs.start).mock
    .calls;
  expect(calls[1]?.[0]).toEqual(calls[0]?.[0]);
  expect(calls[0]?.[0]).toMatchObject({
    sourceThreadId: "source-task",
    destinationProjectId: "destination-project",
    source: { handle: null },
    destination: { handle: "ssh.work" },
  });
});
