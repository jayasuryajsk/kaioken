// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  MODEL_FAVORITES_STORAGE_KEY,
  MODEL_RECENTS_STORAGE_KEY,
} from "@/lib/model-picker-preferences";
import {
  ExecutionControls,
  type ExecutionControlsProps,
} from "./ExecutionControls";

function makeExecutionControlsProps(
  providerOnChange?: (value: string) => void,
): ExecutionControlsProps {
  return {
    provider: {
      options: [
        { value: "codex", label: "Codex" },
        { value: "claude", label: "Claude Code" },
      ],
      selectedId: "codex",
      onChange: providerOnChange,
      hasMultiple: true,
    },
    model: {
      active: null,
      selected: "gpt-5",
      options: [
        { value: "gpt-5", label: "GPT-5" },
        { value: "gpt-5-mini", label: "GPT-5 Mini" },
      ],
      moreOptions: [],
      isLoading: false,
      loadFailed: false,
      loadError: null,
      onChange: vi.fn(),
    },
    reasoning: {
      value: "medium",
      options: [
        { value: "low", label: "Low" },
        { value: "medium", label: "Medium" },
      ],
      onChange: vi.fn(),
    },
  };
}

function renderExecutionControls(props: ExecutionControlsProps) {
  const { wrapper } = createQueryClientTestHarness();
  return render(<ExecutionControls {...props} />, { wrapper });
}

function openModelPicker() {
  fireEvent.click(screen.getByRole("button", { name: "Model" }));
}

beforeEach(() => {
  window.localStorage.removeItem(MODEL_FAVORITES_STORAGE_KEY);
  window.localStorage.removeItem(MODEL_RECENTS_STORAGE_KEY);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("ExecutionControls", () => {
  it("splits model, reasoning, and fast mode into separate controls", () => {
    renderExecutionControls({
      ...makeExecutionControlsProps(),
      serviceTier: { value: "default", onChange: vi.fn(), supported: true },
    });

    const modelTrigger = screen.getByRole("button", { name: "Model" });
    expect(modelTrigger.textContent).toContain("GPT-5");
    expect(modelTrigger.textContent).not.toContain("Medium");
    expect(
      screen.getByRole("button", { name: "Reasoning" }).textContent,
    ).toContain("Medium");
    expect(
      screen
        .getByRole("button", { name: "Fast mode" })
        .getAttribute("aria-pressed"),
    ).toBe("false");
  });

  it("hides provider tabs when the provider is locked", () => {
    renderExecutionControls(makeExecutionControlsProps());

    openModelPicker();

    expect(screen.queryByText("Codex models")).not.toBeNull();
    expect(screen.queryByTitle("Claude Code")).toBeNull();
  });

  it("shows provider tabs when provider changes are allowed", () => {
    renderExecutionControls(makeExecutionControlsProps(vi.fn()));

    openModelPicker();

    expect(screen.queryByTitle("Claude Code")).not.toBeNull();
  });

  it("lets a model be starred into favorites", () => {
    const props = makeExecutionControlsProps();
    renderExecutionControls(props);

    openModelPicker();

    fireEvent.click(
      screen.getAllByRole("button", { name: "Add to favorites" })[1]!,
    );

    expect(screen.getByTestId("model-picker-favorites").textContent).toContain(
      "GPT-5 Mini",
    );
    expect(
      JSON.parse(
        window.localStorage.getItem(MODEL_FAVORITES_STORAGE_KEY) ?? "[]",
      ),
    ).toEqual([
      {
        providerId: "codex",
        providerLabel: "Codex",
        model: "gpt-5-mini",
        label: "GPT-5 Mini",
      },
    ]);
  });

  it("records a picked model with its reasoning level as a recent", () => {
    const props = makeExecutionControlsProps();
    renderExecutionControls(props);

    openModelPicker();
    fireEvent.click(screen.getByText("GPT-5 Mini"));

    expect(props.model.onChange).toHaveBeenCalledWith("gpt-5-mini");
    expect(
      JSON.parse(
        window.localStorage.getItem(MODEL_RECENTS_STORAGE_KEY) ?? "[]",
      ),
    ).toMatchObject([
      { providerId: "codex", model: "gpt-5-mini", reasoningLevel: "medium" },
    ]);
  });

  it("hands a saved model from another provider to the caller instead of previewing it", () => {
    window.localStorage.setItem(
      MODEL_FAVORITES_STORAGE_KEY,
      JSON.stringify([
        {
          providerId: "claude",
          providerLabel: "Claude Code",
          model: "claude-opus-5",
          label: "Opus 5",
        },
      ]),
    );
    const onSelectSaved = vi.fn();
    const props = makeExecutionControlsProps();
    renderExecutionControls({
      ...props,
      provider: { ...props.provider, onSelectSaved },
    });

    openModelPicker();
    fireEvent.click(screen.getByText("Opus 5"));

    expect(onSelectSaved).toHaveBeenCalledWith({
      providerId: "claude",
      model: "claude-opus-5",
    });
    expect(props.model.onChange).not.toHaveBeenCalled();
  });

  it("lets a locked thread browse another provider and only hands off when a model is picked", () => {
    const onSelectSaved = vi.fn();
    const props = makeExecutionControlsProps();
    renderExecutionControls({
      ...props,
      provider: { ...props.provider, onChange: undefined, onSelectSaved },
    });

    openModelPicker();
    fireEvent.click(screen.getByTitle("Claude Code"));

    expect(onSelectSaved).not.toHaveBeenCalled();
    expect(screen.queryByText("Claude Code models")).not.toBeNull();
  });

  it("keeps showing the known model when model options fail to load", () => {
    const props = makeExecutionControlsProps();
    renderExecutionControls({
      ...props,
      model: {
        ...props.model,
        active: { model: "o4-mini" },
        options: [],
        loadFailed: true,
        loadError: { providerId: "codex", code: "failed" },
      },
    });

    const trigger = screen.getByRole("button", { name: "Model" });

    expect(trigger.textContent).toContain("o4-mini");
    expect(trigger.textContent).not.toContain("Failed to load models");
  });

  it("maps disabled fast mode to the explicit default service tier", () => {
    const onServiceTierChange = vi.fn();
    renderExecutionControls({
      ...makeExecutionControlsProps(),
      serviceTier: {
        value: "fast",
        onChange: onServiceTierChange,
        supported: true,
      },
    });

    fireEvent.click(screen.getByRole("button", { name: "Fast mode" }));

    expect(onServiceTierChange).toHaveBeenCalledWith("default");
  });
});
