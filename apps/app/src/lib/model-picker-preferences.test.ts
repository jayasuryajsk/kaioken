import { describe, expect, it } from "vitest";
import {
  MODEL_RECENTS_LIMIT,
  isFavoriteModel,
  modelSelectionKey,
  pushRecentModel,
  toggleFavoriteModel,
  type ModelRecentEntry,
  type ModelSelectionEntry,
} from "./model-picker-preferences";

const astra: ModelSelectionEntry = {
  providerId: "codex",
  providerLabel: "Codex",
  model: "gpt-6-astra",
  label: "6-Astra",
};
const opus: ModelSelectionEntry = {
  providerId: "claude-code",
  providerLabel: "Claude Code",
  model: "claude-opus-5[1m]",
  label: "Opus 5 (1M)",
};

describe("favorites", () => {
  it("keys entries by provider and model so the same id on two providers stays distinct", () => {
    expect(modelSelectionKey(astra)).not.toBe(
      modelSelectionKey({ ...astra, providerId: "other" }),
    );
  });

  it("toggles an entry on and off without touching the others", () => {
    const withAstra = toggleFavoriteModel([], astra);
    expect(isFavoriteModel(withAstra, astra)).toBe(true);
    const withBoth = toggleFavoriteModel(withAstra, opus);
    expect(withBoth.map((entry) => entry.model)).toEqual([
      astra.model,
      opus.model,
    ]);
    const withoutAstra = toggleFavoriteModel(withBoth, {
      ...astra,
      label: "renamed",
    });
    expect(withoutAstra).toEqual([opus]);
  });
});

describe("recents", () => {
  it("moves a reused model to the front, updates its reasoning, and caps the list", () => {
    let recents: ModelRecentEntry[] = [];
    recents = pushRecentModel(
      recents,
      { ...astra, reasoningLevel: "medium" },
      1,
    );
    recents = pushRecentModel(recents, { ...opus, reasoningLevel: "high" }, 2);
    recents = pushRecentModel(
      recents,
      { ...astra, providerId: "pi", reasoningLevel: "low" },
      3,
    );
    recents = pushRecentModel(
      recents,
      { ...astra, reasoningLevel: "xhigh" },
      4,
    );
    expect(recents).toHaveLength(MODEL_RECENTS_LIMIT);
    expect(recents[0]).toMatchObject({
      model: astra.model,
      providerId: "codex",
      reasoningLevel: "xhigh",
      usedAt: 4,
    });
    expect(recents.map((entry) => entry.providerId)).toEqual([
      "codex",
      "pi",
      "claude-code",
    ]);
  });
});
