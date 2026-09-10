// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, expect, it, vi } from "vitest";
import { MachineLifecycleNotice } from "./MachineLifecycleNotice";
import { sdk } from "@/lib/sdk";

vi.mock("@/lib/sdk", () => ({
  sdk: { hosts: { experimental_lifecycle: vi.fn() } },
}));
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function renderNotice() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MachineLifecycleNotice hostId="machine" />
    </QueryClientProvider>,
  );
  return { view, client };
}

it("reports a recoverable failure as destructive", async () => {
  vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
    phase: "removing",
    recoveryState: "recoverable",
    message: "Machine removal failed: Modal returned HTTP 500.",
  });
  const { view, client } = renderNotice();
  const notice = await view.findByRole("status");
  expect(notice.textContent).toBe(
    "Machine removal failed: Modal returned HTTP 500.",
  );
  expect(notice.className).toContain("text-destructive-text");
  client.clear();
});

it("reports maintenance in progress without destructive styling", async () => {
  vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
    phase: "suspending",
    recoveryState: "draining",
    message:
      "Preserving this machine. Active turns will be interrupted and open terminals closed before the filesystem is saved.",
  });
  const { view, client } = renderNotice();
  const notice = await view.findByRole("status");
  expect(notice.className).not.toContain("text-destructive-text");
  client.clear();
});

it("renders nothing when core reports no maintenance", async () => {
  vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
    phase: "active",
    recoveryState: "healthy",
    message: null,
  });
  const { view, client } = renderNotice();
  await vi.waitFor(() => {
    expect(vi.mocked(sdk.hosts.experimental_lifecycle)).toHaveBeenCalled();
  });
  expect(view.queryByRole("status")).toBeNull();
  client.clear();
});
