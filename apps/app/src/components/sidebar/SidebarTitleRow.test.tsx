// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SidebarTitleRow } from "./AppSidebar";

afterEach(() => cleanup());

describe("SidebarTitleRow", () => {
  it("shows the priority count and routes search and bell clicks", () => {
    const onSearch = vi.fn();
    const onPriority = vi.fn();
    render(
      <SidebarTitleRow
        needsYouCount={3}
        onSearch={onSearch}
        onPriority={onPriority}
      />,
    );
    expect(screen.getByText("Kaioken")).toBeTruthy();
    expect(screen.getByTestId("app-sidebar-priority-count").textContent).toBe(
      "3",
    );
    fireEvent.click(screen.getByRole("button", { name: "Search threads" }));
    expect(onSearch).toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Priority (3 waiting)" }),
    );
    expect(onPriority).toHaveBeenCalled();
  });

  it("hides the count when nothing is waiting", () => {
    render(
      <SidebarTitleRow
        needsYouCount={0}
        onSearch={vi.fn()}
        onPriority={vi.fn()}
      />,
    );
    expect(screen.queryByTestId("app-sidebar-priority-count")).toBeNull();
    expect(
      screen.getByRole("button", { name: "Priority (nothing waiting)" }),
    ).toBeTruthy();
  });
});
