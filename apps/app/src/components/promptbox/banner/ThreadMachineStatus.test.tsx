// @vitest-environment jsdom

import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ThreadMachineStatusBanner } from "./ThreadMachineStatus";

const provider = {
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  description: "Run a machine for development.",
  icon: "Cloud",
  logoUrl: null,
  pluginId: "environment-modal-sandbox",
  inputs: null,
  acceptsEmptyInputs: true,
  supportsSuspend: true,
};

describe("ThreadMachineStatusBanner", () => {
  it("labels a paused machine with its provider icon and host name", () => {
    const { container } = render(
      <ThreadMachineStatusBanner
        host={{
          name: "Modal sandbox ugxe6e",
          type: "ephemeral",
          machineProviderId: provider.id,
        }}
        provider={provider}
        phase="suspended"
        resuming={false}
        error={null}
        onResume={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("status", {
        name: "Modal sandbox ugxe6e is paused",
      }),
    ).toBeTruthy();
    expect(container.querySelector('[data-icon="Cloud"]')).not.toBeNull();
    expect(screen.queryByText(provider.displayName)).toBeNull();
  });
});
