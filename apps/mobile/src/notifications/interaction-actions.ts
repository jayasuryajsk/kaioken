import * as Notifications from "expo-notifications";
import { createMobileFetch } from "@/lib/sdk/mobile-fetch";

export const APPROVAL_CATEGORY = "approval";
export const QUESTION_CATEGORY = "question";
export const ALLOW_ONCE_ACTION = "allow_once";
export const ALLOW_SESSION_ACTION = "allow_for_session";
export const DENY_ACTION = "deny";
export const REPLY_ACTION = "reply";

export async function registerInteractionCategories(): Promise<void> {
  await Notifications.setNotificationCategoryAsync(APPROVAL_CATEGORY, [
    {
      identifier: ALLOW_ONCE_ACTION,
      buttonTitle: "Allow",
      options: { opensAppToForeground: false },
    },
    {
      identifier: ALLOW_SESSION_ACTION,
      buttonTitle: "Allow for session",
      options: { opensAppToForeground: false },
    },
    {
      identifier: DENY_ACTION,
      buttonTitle: "Deny",
      options: { opensAppToForeground: false, isDestructive: true },
    },
  ]);
  await Notifications.setNotificationCategoryAsync(QUESTION_CATEGORY, [
    {
      identifier: REPLY_ACTION,
      buttonTitle: "Reply",
      textInput: { submitButtonTitle: "Send", placeholder: "Your answer" },
      options: { opensAppToForeground: false },
    },
  ]);
}

export type InteractionResolution =
  | { kind: "approval"; decision: "allow_once" | "allow_for_session" | "deny" }
  | { kind: "answer"; text: string };

export function resolutionForAction(
  actionIdentifier: string,
  userText: string | undefined,
): InteractionResolution | null {
  if (actionIdentifier === ALLOW_ONCE_ACTION) {
    return { kind: "approval", decision: "allow_once" };
  }
  if (actionIdentifier === ALLOW_SESSION_ACTION) {
    return { kind: "approval", decision: "allow_for_session" };
  }
  if (actionIdentifier === DENY_ACTION) {
    return { kind: "approval", decision: "deny" };
  }
  if (actionIdentifier === REPLY_ACTION) {
    const text = userText?.trim() ?? "";
    return text.length > 0 ? { kind: "answer", text } : null;
  }
  return null;
}

const resolveFetch = createMobileFetch((input, init) => fetch(input, init));

interface QuestionShape {
  id: string;
  options: readonly { value: string; label: string }[] | null;
  allowFreeText: boolean;
}

function questionsFromInteraction(payload: unknown): QuestionShape[] {
  if (typeof payload !== "object" || payload === null) return [];
  const record = payload as { questions?: unknown };
  if (!Array.isArray(record.questions)) return [];
  const questions: QuestionShape[] = [];
  for (const raw of record.questions) {
    if (typeof raw !== "object" || raw === null) continue;
    const question = raw as {
      id?: unknown;
      options?: unknown;
      allowFreeText?: unknown;
    };
    if (typeof question.id !== "string") continue;
    const options = Array.isArray(question.options)
      ? question.options
          .filter(
            (option): option is { value: string; label: string } =>
              typeof option === "object" &&
              option !== null &&
              typeof (option as { value?: unknown }).value === "string" &&
              typeof (option as { label?: unknown }).label === "string",
          )
          .map((option) => ({ value: option.value, label: option.label }))
      : null;
    questions.push({
      id: question.id,
      options,
      allowFreeText: question.allowFreeText !== false,
    });
  }
  return questions;
}

function answerBody(
  questions: QuestionShape[],
  text: string,
): Record<string, unknown> {
  const answers: Record<string, { selected: string[]; freeText?: string }> = {};
  const normalized = text.trim().toLowerCase();
  for (const [index, question] of questions.entries()) {
    const match = question.options?.find(
      (option) =>
        option.label.trim().toLowerCase() === normalized ||
        option.value.toLowerCase() === normalized,
    );
    if (match) {
      answers[question.id] = { selected: [match.value] };
    } else if (index === 0) {
      answers[question.id] = { selected: [], freeText: text };
    } else {
      answers[question.id] = { selected: [] };
    }
  }
  return { kind: "user_answer", answers };
}

export type ResolveOutcome =
  | { status: "resolved" }
  | { status: "gone" }
  | { status: "failed"; message: string };

export async function resolveInteractionOnServer(args: {
  serverUrl: string;
  threadId: string;
  interactionId: string;
  resolution: InteractionResolution;
}): Promise<ResolveOutcome> {
  const base = args.serverUrl.replace(/\/+$/u, "");
  const interactionUrl = `${base}/api/v1/threads/${encodeURIComponent(args.threadId)}/interactions/${encodeURIComponent(args.interactionId)}`;
  let body: Record<string, unknown>;
  if (args.resolution.kind === "approval") {
    body =
      args.resolution.decision === "deny"
        ? { decision: "deny" }
        : { decision: args.resolution.decision, grantedPermissions: null };
  } else {
    const lookup = await resolveFetch(interactionUrl, {
      method: "GET",
      headers: new Headers({ accept: "application/json" }),
      signal: AbortSignal.timeout(10_000),
    });
    if (lookup.status === 404) return { status: "gone" };
    if (!lookup.ok) {
      return { status: "failed", message: `HTTP ${lookup.status}` };
    }
    const interaction = (await lookup.json()) as {
      status?: unknown;
      payload?: unknown;
    };
    if (interaction.status !== "pending") return { status: "gone" };
    body = answerBody(
      questionsFromInteraction(interaction.payload),
      args.resolution.text,
    );
  }
  const response = await resolveFetch(`${interactionUrl}/resolve`, {
    method: "POST",
    headers: new Headers({
      accept: "application/json",
      "content-type": "application/json",
    }),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (response.ok) return { status: "resolved" };
  if (response.status === 404 || response.status === 409) {
    return { status: "gone" };
  }
  return { status: "failed", message: `HTTP ${response.status}` };
}
