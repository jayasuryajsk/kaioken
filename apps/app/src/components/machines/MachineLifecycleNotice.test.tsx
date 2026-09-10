// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { MachineLifecycleNoticeContent } from "./MachineLifecycleNotice";

afterEach(cleanup);

it("reports a failed operation as destructive", () => {
  const view = render(
    <MachineLifecycleNoticeContent
      notice={{
        phase: "active",
        message: "Machine suspension failed: Modal returned HTTP 500.",
      }}
    />,
  );
  const notice = view.getByRole("status");
  expect(notice.textContent).toBe(
    "Machine suspension failed: Modal returned HTTP 500.",
  );
  expect(notice.className).toContain("text-destructive-text");
});

it("reports maintenance in progress without destructive styling", () => {
  const view = render(
    <MachineLifecycleNoticeContent
      notice={{
        phase: "suspending",
        message:
          "Preserving this machine. Active turns will be interrupted and open terminals closed before the filesystem is saved.",
      }}
    />,
  );
  expect(view.getByRole("status").className).not.toContain(
    "text-destructive-text",
  );
});

it("renders nothing when the host has no maintenance message", () => {
  const view = render(
    <MachineLifecycleNoticeContent
      notice={{ phase: "active", message: null }}
    />,
  );
  expect(view.queryByRole("status")).toBeNull();
});
