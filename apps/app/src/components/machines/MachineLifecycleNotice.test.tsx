// @vitest-environment jsdom
import { cleanup, fireEvent, render } from "@testing-library/react";
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

function renderNotice(onRemove: () => void = () => {}) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  const view = render(
    <QueryClientProvider client={client}>
      <MachineLifecycleNotice hostId="machine" onRemove={onRemove} />
    </QueryClientProvider>,
  );
  return { view, client };
}

it("delegates explicit removal through the existing confirmation flow", async () => {
  vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
    phase: "retiring",
    recoveryState: "recoverable",
    message: "Machine removal failed: Modal returned HTTP 500.",
  });
  const remove = vi.fn();
  const { view, client } = renderNotice(remove);
  fireEvent.click(await view.findByText("Remove machine"));
  expect(remove).toHaveBeenCalledTimes(1);
  client.clear();
});

it("reports maintenance in progress without offering removal", async () => {
  vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
    phase: "suspending",
    recoveryState: "draining",
    message:
      "Preserving this machine. Active turns will be interrupted and open terminals closed before the filesystem is saved.",
  });
  const { view, client } = renderNotice();
  expect(await view.findByText(/Preserving this machine/)).toBeTruthy();
  expect(view.queryByText("Remove machine")).toBeNull();
  client.clear();
});

it("shows a recoverable failure with its recovery action", async () => {
  vi.mocked(sdk.hosts.experimental_lifecycle).mockResolvedValue({
    phase: "active",
    recoveryState: "recoverable",
    message: "Machine suspension failed: Modal returned HTTP 500.",
  });
  const { view, client } = renderNotice();
  expect(
    await view.findByText("Machine suspension failed: Modal returned HTTP 500."),
  ).toBeTruthy();
  expect(view.getByText("Remove machine")).toBeTruthy();
  client.clear();
});
