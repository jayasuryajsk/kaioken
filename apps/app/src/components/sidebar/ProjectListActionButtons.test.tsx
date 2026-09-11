// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  ProjectListNewThreadAction,
  ProjectListSearchThreadsAction,
} from "./ProjectList";

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
}));

vi.mock("@/components/commands/AppCommandProvider", () => ({
  useAppCommandRunner: () => ({
    dispatch: mocks.dispatch,
    isCommandAvailable: () => true,
  }),
  useAppCommandShortcut: (command: string) =>
    command === "thread.search"
      ? { ariaKeyshortcuts: "Meta+K", label: "⌘K" }
      : command === "thread.quick"
        ? { ariaKeyshortcuts: "Meta+Shift+J", label: "⇧⌘J" }
        : null,
  useIsAppCommandModifierHeld: () => false,
}));

afterEach(() => {
  cleanup();
  mocks.dispatch.mockReset();
});

describe("ProjectListSearchThreadsAction", () => {
  it("reveals the reserved trailing Search shortcut on hover or focus without changing activation", () => {
    const onSearchThreads = vi.fn();
    render(
      <ProjectListSearchThreadsAction onSearchThreads={onSearchThreads} />,
    );

    const button = screen.getByRole("button", {
      name: "Search threads (⌘K)",
    });
    const shortcut = screen.getByText("⌘K");
    const label = screen.getByText("Search threads");

    expect(button.getAttribute("aria-keyshortcuts")).toBe("Meta+K");
    expect(shortcut.tagName).toBe("KBD");
    expect(shortcut.getAttribute("aria-hidden")).toBe("true");
    expect(label.classList.contains("flex-1")).toBe(true);
    const shortcutSlot = shortcut.parentElement;
    expect(shortcutSlot?.lastElementChild).toBe(shortcut);
    expect(button.classList.contains("group/search-threads")).toBe(true);
    expect(shortcutSlot?.classList.contains("opacity-0")).toBe(true);
    expect(
      shortcutSlot?.classList.contains(
        "group-hover/search-threads:opacity-100",
      ),
    ).toBe(true);
    expect(
      shortcutSlot?.classList.contains(
        "group-focus-visible/search-threads:opacity-100",
      ),
    ).toBe(true);
    expect(
      shortcutSlot?.classList.contains("max-md:pointer-coarse:hidden"),
    ).toBe(true);
    expect(button.classList.contains("pr-1")).toBe(true);

    fireEvent.click(button);

    expect(onSearchThreads).toHaveBeenCalledOnce();
    expect(mocks.dispatch).toHaveBeenCalledWith("thread.search", button);
  });
});

describe("ProjectListNewThreadAction", () => {
  it("offers a quick chat beside New thread that starts without a project", () => {
    const onNewChat = vi.fn();
    const onQuickChat = vi.fn();
    render(
      <ProjectListNewThreadAction
        onNewChat={onNewChat}
        onQuickChat={onQuickChat}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: "Quick chat without a project (⇧⌘J)",
      }),
    );
    expect(onQuickChat).toHaveBeenCalledTimes(1);
    expect(onNewChat).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "New thread" }));
    expect(onNewChat).toHaveBeenCalledTimes(1);
  });

  it("renders only the New thread button when quick chat is unavailable", () => {
    render(<ProjectListNewThreadAction onNewChat={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Quick chat/ })).toBeNull();
  });
});
