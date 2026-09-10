// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { MachineAccessSettings } from "./MachineAccessSettings";

const mocks = vi.hoisted(() => ({
  config: vi.fn(),
  mutate: vi.fn(),
  mutateAsync: vi.fn(),
  isPending: false,
}));
vi.mock("@/components/pickers/OptionPicker", () => ({
  OptionPicker: ({
    value,
    onChange,
    disabled,
    options,
  }: {
    value: string;
    onChange: (value: string) => void;
    disabled: boolean;
    options: Array<{ value: string; label: string }>;
  }) => (
    <select
      aria-label="Connection method"
      value={value}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  ),
}));
vi.mock("@/hooks/queries/system-queries", () => ({
  useSystemConfig: mocks.config,
}));
vi.mock("@/hooks/mutations/settings-mutations", () => ({
  useUpdateGeneralSettings: () => ({
    isPending: mocks.isPending,
    mutate: mocks.mutate,
    mutateAsync: mocks.mutateAsync,
  }),
}));
afterEach(cleanup);
beforeEach(() => {
  mocks.mutate.mockReset();
  mocks.mutateAsync.mockReset();
  mocks.mutateAsync.mockResolvedValue(undefined);
  mocks.isPending = false;
});

function show(defaultProviderId: string, available = false) {
  mocks.config.mockReturnValue({
    data: makeSystemConfig({
      serverAccess: {
        providers: [
          {
            id: "relay",
            displayName: "Managed relay",
            description: "Use a managed relay address.",
            pluginId: "relay-plugin",
            availability: available
              ? {
                  status: "available",
                  serverUrl: "https://relay.example.com",
                }
              : { status: "setup-required", message: "Set up the relay" },
          },
          {
            id: "direct",
            displayName: "Manual",
            description: "Use your own domain or network address.",
            pluginId: null,
            availability: { status: "available" },
          },
        ],
        defaultProviderId,
        effectiveUrl: "https://bb.example.com",
        urlSource: "BB_EXTERNAL_URL",
      },
    }),
  });
  return render(
    <MemoryRouter>
      <MachineAccessSettings />
    </MemoryRouter>,
  );
}

it("links provider setup through its registering plugin", () => {
  show("relay");
  expect(
    screen
      .getByRole("link", { name: "Set up Managed relay" })
      .getAttribute("href"),
  ).toBe("/settings/plugins/relay-plugin");
  expect(screen.getByText("Set up the relay")).toBeTruthy();
  expect(screen.queryByText("Not connected")).toBeNull();
  expect(screen.queryByRole("textbox")).toBeNull();
  expect(screen.getAllByRole("option")).toHaveLength(2);
});

it("shows the URL input only for Manual", () => {
  show("direct");
  expect(screen.getByRole("textbox", { name: "Server address" })).toBeTruthy();
  expect(
    screen.queryByRole("link", { name: "Set up Managed relay" }),
  ).toBeNull();
});

it("retains diagnostics for an available provider without showing setup", () => {
  show("relay", true);
  expect(screen.getByText("Connected")).toBeTruthy();
  expect(
    screen
      .getByRole("link", { name: "https://relay.example.com" })
      .getAttribute("href"),
  ).toBe("https://relay.example.com");
  expect(
    screen.getByRole("link", { name: "Manage" }).getAttribute("href"),
  ).toBe("/settings/plugins/relay-plugin");
  expect(
    screen.queryByRole("link", { name: "Set up Managed relay" }),
  ).toBeNull();
});

it("keeps the selection through saving and a stale config refresh", () => {
  const view = show("relay");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "direct" },
  });
  expect(screen.getByRole("textbox", { name: "Server address" })).toBeTruthy();
  expect(mocks.mutate.mock.calls[0][0].defaultMachineAccess).toBe("direct");
  const refresh = () =>
    view.rerender(
      <MemoryRouter>
        <MachineAccessSettings />
      </MemoryRouter>,
    );
  mocks.isPending = true;
  refresh();
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("direct");
  mocks.isPending = false;
  refresh();
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("direct");
  const config = mocks.config();
  mocks.config.mockReturnValue({
    data: {
      ...config.data,
      serverAccess: {
        ...config.data.serverAccess,
        defaultProviderId: "direct",
      },
    },
  });
  refresh();
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("direct");
  mocks.config.mockReturnValue(config);
  refresh();
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("relay");
});

it("restores the saved selection when saving fails", () => {
  show("relay");
  fireEvent.change(screen.getByRole("combobox"), {
    target: { value: "direct" },
  });
  expect(screen.getByRole("textbox", { name: "Server address" })).toBeTruthy();
  act(() => mocks.mutate.mock.calls[0][1].onError(new Error("Save failed")));
  expect(screen.getByRole<HTMLSelectElement>("combobox").value).toBe("relay");
  expect(screen.queryByRole("textbox", { name: "Server address" })).toBeNull();
});

const URL_ERROR = "Enter a valid HTTP or HTTPS URL without credentials";

it("blames the save, not the URL, when the request fails", async () => {
  show("direct");
  fireEvent.change(screen.getByRole("textbox", { name: "Server address" }), {
    target: { value: "https://bb.example.com" },
  });
  mocks.mutateAsync.mockRejectedValue(new Error("Daemon unreachable"));
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  const alert = await screen.findByRole("alert");
  expect(alert.textContent).toBe("Daemon unreachable");
  expect(screen.queryByText(URL_ERROR)).toBeNull();
});

it("drops a stale validation error once the address is edited", async () => {
  show("direct");
  const address = screen.getByRole("textbox", { name: "Server address" });
  fireEvent.change(address, { target: { value: "http://localhost:3000" } });
  fireEvent.click(screen.getByRole("button", { name: "Save" }));
  expect((await screen.findByRole("alert")).textContent).toBe(
    "Other machines cannot reach localhost. Use a domain or shared-network address.",
  );
  expect(mocks.mutateAsync).not.toHaveBeenCalled();
  fireEvent.change(address, { target: { value: "https://bb.example.com" } });
  expect(screen.queryByRole("alert")).toBeNull();
  expect(address.getAttribute("aria-invalid")).toBe("false");
});
