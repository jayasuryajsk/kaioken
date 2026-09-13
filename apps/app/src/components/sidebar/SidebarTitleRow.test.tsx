// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarTitleRow } from "./AppSidebar";

afterEach(() => cleanup());

describe("SidebarTitleRow", () => {
  it("shows the waiting count and toggles the priority view from the bell", () => {
    const onSearch = vi.fn();
    const onTogglePriority = vi.fn();
    render(
      <SidebarTitleRow
        needsYouCount={3}
        onSearch={onSearch}
        priorityView={false}
        onTogglePriority={onTogglePriority}
      />,
    );
    expect(screen.getByText("Kaioken")).toBeTruthy();
    expect(screen.getByTestId("app-sidebar-priority-count").textContent).toBe(
      "3",
    );
    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));
    expect(onSearch).toHaveBeenCalled();
    const bell = screen.getByRole("button", {
      name: "Show priority view (3 waiting)",
    });
    expect(bell.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(bell);
    expect(onTogglePriority).toHaveBeenCalled();
  });

  it("marks the bell pressed while the priority view is on", () => {
    render(
      <SidebarTitleRow
        needsYouCount={0}
        onSearch={vi.fn()}
        priorityView
        onTogglePriority={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("app-sidebar-priority-count")).toBeNull();
    expect(
      screen
        .getByRole("button", { name: "Show all threads" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});
