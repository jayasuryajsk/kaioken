// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerPicker } from "./ComputerPicker";

const home = {
  handle: "studio",
  name: "Mac Studio",
  url: "https://studio.kaioken.app",
  live: true,
  lastSeenAt: null,
  home: true,
};
const laptop = {
  handle: "laptop",
  name: "MacBook",
  url: "https://laptop.kaioken.app",
  live: true,
  lastSeenAt: null,
  home: false,
};

afterEach(cleanup);

describe("ComputerPicker", () => {
  it("stays out of the way when there is no other computer", () => {
    const { container } = render(
      <ComputerPicker computers={[home]} value={null} onChange={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("switches between this computer and another one", () => {
    const onChange = vi.fn();
    render(
      <ComputerPicker
        computers={[home, laptop]}
        value={null}
        onChange={onChange}
      />,
    );
    const trigger = screen.getByRole("button", { name: "Computer" });
    expect(trigger.textContent).toContain("This computer");
    fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByRole("menuitem", { name: /MacBook/ }));
    expect(onChange).toHaveBeenCalledWith("laptop");
  });

  it("shows an offline computer without letting you pick it", () => {
    const onChange = vi.fn();
    render(
      <ComputerPicker
        computers={[home, { ...laptop, live: false }]}
        value={null}
        onChange={onChange}
      />,
    );
    fireEvent.pointerDown(screen.getByRole("button", { name: "Computer" }), {
      button: 0,
      ctrlKey: false,
    });
    const item = screen.getByRole("menuitem", { name: /MacBook/ });
    expect(item.getAttribute("aria-disabled")).toBe("true");
    fireEvent.click(item);
    expect(onChange).not.toHaveBeenCalled();
  });
});
