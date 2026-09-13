import { closeSync, openSync, readSync, statSync } from "node:fs";
import { normalizeCodexItem, type CodexRolloutItem } from "./items.js";
import {
  describeSource,
  eventMsgPayloadSchema,
  isSubagentMeta,
  parseRolloutLine,
  sessionMetaPayloadSchema,
} from "./lines.js";
import { userMessageText } from "./rollout.js";

export interface CodexRolloutSummary {
  id: string;
  path: string;
  cwd: string;
  originator: string;
  source: string;
  createdAt: string | null;
  updatedAt: number;
  firstPrompt: string | null;
  isSubagent: boolean;
  archived: boolean;
}

const HEADER_BYTES = 64 * 1024;
const PROMPT_SCAN_BYTES = 2 * 1024 * 1024;
const TAIL_BYTES = 64 * 1024;
const FIRST_PROMPT_MAX_LENGTH = 400;

function readPrefix(path: string, bytes: number): string {
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(bytes);
    const read = readSync(descriptor, buffer, 0, bytes, 0);
    return buffer.toString("utf8", 0, read);
  } finally {
    closeSync(descriptor);
  }
}

function readSuffix(path: string, bytes: number): string {
  const size = statSync(path).size;
  const start = Math.max(0, size - bytes);
  const descriptor = openSync(path, "r");
  try {
    const buffer = Buffer.alloc(size - start);
    const read = readSync(descriptor, buffer, 0, buffer.length, start);
    return buffer.toString("utf8", 0, read);
  } finally {
    closeSync(descriptor);
  }
}

export function readRolloutHeader(path: string): {
  id: string;
  cwd: string;
  originator: string;
  source: string;
  createdAt: string | null;
  isSubagent: boolean;
} | null {
  const prefix = readPrefix(path, HEADER_BYTES);
  const newline = prefix.indexOf("\n");
  const firstLine = newline === -1 ? prefix : prefix.slice(0, newline);
  const line = parseRolloutLine(firstLine, 0);
  if (line === null || line.type !== "session_meta") return null;
  const meta = sessionMetaPayloadSchema.safeParse(line.payload);
  if (!meta.success) return null;
  return {
    id: meta.data.id,
    cwd: meta.data.cwd,
    originator: meta.data.originator,
    source: describeSource(meta.data.source),
    createdAt: meta.data.timestamp ?? line.timestamp,
    isSubagent: isSubagentMeta(meta.data),
  };
}

function truncatePrompt(text: string): string {
  const flattened = text.replace(/\s+/g, " ").trim();
  return flattened.length <= FIRST_PROMPT_MAX_LENGTH
    ? flattened
    : `${flattened.slice(0, FIRST_PROMPT_MAX_LENGTH - 1)}…`;
}

function firstPromptFromLines(lines: readonly string[]): string | null {
  for (const [index, raw] of lines.entries()) {
    if (!raw.includes('"UserMessage"') && !raw.includes('"role":"user"')) {
      continue;
    }
    const line = parseRolloutLine(raw, index);
    if (line === null) continue;
    if (line.type === "event_msg") {
      const parsed = eventMsgPayloadSchema.safeParse(line.payload);
      if (!parsed.success || parsed.data.type !== "item_completed") continue;
      const normalized = normalizeCodexItem(parsed.data.item);
      if (normalized.outcome !== "item") continue;
      const item: CodexRolloutItem = normalized.item;
      if (item.type !== "userMessage") continue;
      const text = userMessageText(item);
      if (text.length > 0) return truncatePrompt(text);
    }
  }
  return null;
}

export function readRolloutSummary(
  path: string,
  options: { archived: boolean },
): CodexRolloutSummary | null {
  const header = readRolloutHeader(path);
  if (header === null) return null;
  const prefix = readPrefix(path, PROMPT_SCAN_BYTES);
  const lines = prefix.split("\n");
  if (!prefix.endsWith("\n")) lines.pop();
  return {
    id: header.id,
    path,
    cwd: header.cwd,
    originator: header.originator,
    source: header.source,
    createdAt: header.createdAt,
    updatedAt: statSync(path).mtimeMs,
    firstPrompt: firstPromptFromLines(lines),
    isSubagent: header.isSubagent,
    archived: options.archived,
  };
}

export function readRolloutLastOrdinal(path: string): number {
  const suffix = readSuffix(path, TAIL_BYTES);
  const lines = suffix.split("\n").filter((line) => line.trim().length > 0);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = parseRolloutLine(lines[index] ?? "", index);
    if (line !== null) return line.ordinal;
  }
  return -1;
}

export function mergeRolloutSummaries(
  summaries: readonly CodexRolloutSummary[],
): CodexRolloutSummary[] {
  const byId = new Map<string, CodexRolloutSummary[]>();
  for (const summary of summaries) {
    const group = byId.get(summary.id);
    if (group === undefined) {
      byId.set(summary.id, [summary]);
    } else {
      group.push(summary);
    }
  }
  return [...byId.values()].map((group) => {
    const ordered = [...group].sort((a, b) =>
      (a.createdAt ?? "").localeCompare(b.createdAt ?? ""),
    );
    const earliest = ordered[0]!;
    const latest = ordered[ordered.length - 1]!;
    return {
      ...latest,
      cwd: earliest.cwd || latest.cwd,
      createdAt: earliest.createdAt,
      updatedAt: Math.max(...ordered.map((summary) => summary.updatedAt)),
      firstPrompt:
        ordered.find((summary) => summary.firstPrompt !== null)?.firstPrompt ??
        null,
    };
  });
}
