import type { PromptTextMention, ReasoningLevel } from "@kaioken/domain";
import { reasoningLevelValues } from "@kaioken/domain";
import type { PromptDraftState } from "./prompt-draft.js";

export const THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY =
  "threadHandoffCreateSeed";

export interface ThreadHandoffTarget {
  providerId: string;
  model: string;
  reasoningLevel: ReasoningLevel | null;
}

export interface ThreadHandoffCreateSeed {
  environmentId: string | null;
  projectId: string;
  sourceThreadId: string;
  sourceThreadTitle: string;
  summary: string | null;
  target: ThreadHandoffTarget | null;
}

interface ThreadHandoffLocationState {
  focusPrompt: true;
  reuseEnvironmentId?: string;
  [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: ThreadHandoffCreateSeed;
}

export function buildThreadHandoffLocationState(
  seed: ThreadHandoffCreateSeed,
): ThreadHandoffLocationState {
  return {
    focusPrompt: true,
    ...(seed.environmentId !== null
      ? { reuseEnvironmentId: seed.environmentId }
      : {}),
    [THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY]: seed,
  };
}

export function readThreadHandoffCreateSeedFromLocationState(
  state: unknown,
): ThreadHandoffCreateSeed | null {
  if (!state || typeof state !== "object") return null;
  const candidate = (state as Record<string, unknown>)[
    THREAD_HANDOFF_CREATE_SEED_LOCATION_STATE_KEY
  ];
  if (!candidate || typeof candidate !== "object") return null;
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.projectId !== "string" ||
    value.projectId.length === 0 ||
    typeof value.sourceThreadId !== "string" ||
    value.sourceThreadId.length === 0 ||
    typeof value.sourceThreadTitle !== "string" ||
    value.sourceThreadTitle.trim().length === 0
  ) {
    return null;
  }
  if (
    value.environmentId !== undefined &&
    value.environmentId !== null &&
    typeof value.environmentId !== "string"
  ) {
    return null;
  }

  const environmentId =
    typeof value.environmentId === "string" && value.environmentId.length > 0
      ? value.environmentId
      : null;
  const summary =
    typeof value.summary === "string" && value.summary.trim().length > 0
      ? value.summary.trim()
      : null;
  const target = readThreadHandoffTarget(value.target);
  if (target === undefined) {
    return null;
  }

  return {
    environmentId,
    projectId: value.projectId,
    sourceThreadId: value.sourceThreadId,
    sourceThreadTitle: value.sourceThreadTitle.trim(),
    summary,
    target,
  };
}

function readThreadHandoffTarget(
  candidate: unknown,
): ThreadHandoffTarget | null | undefined {
  if (candidate === undefined || candidate === null) {
    return null;
  }
  if (typeof candidate !== "object") {
    return undefined;
  }
  const value = candidate as Record<string, unknown>;
  if (
    typeof value.providerId !== "string" ||
    value.providerId.length === 0 ||
    typeof value.model !== "string" ||
    value.model.length === 0
  ) {
    return undefined;
  }
  const reasoningLevel =
    typeof value.reasoningLevel === "string" &&
    (reasoningLevelValues as readonly string[]).includes(value.reasoningLevel)
      ? (value.reasoningLevel as ReasoningLevel)
      : null;
  return { providerId: value.providerId, model: value.model, reasoningLevel };
}

export function buildThreadHandoffPromptDraft(
  seed: ThreadHandoffCreateSeed,
): PromptDraftState {
  const prefix = "Continue from ";
  const mentionText = `@thread:${seed.sourceThreadId}`;
  const text =
    seed.summary === null
      ? `${prefix}${mentionText}`
      : `${prefix}${mentionText}\n\nSummary written by the previous thread:\n\n${seed.summary}`;
  const mention: PromptTextMention = {
    start: prefix.length,
    end: prefix.length + mentionText.length,
    resource: {
      kind: "thread",
      projectId: seed.projectId,
      threadId: seed.sourceThreadId,
      label: seed.sourceThreadTitle,
    },
  };

  return { text, mentions: [mention], attachments: [] };
}
