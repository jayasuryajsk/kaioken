import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import {
  normalizeCodexItem,
  normalizeLegacyResponseItem,
  type CodexRolloutItem,
} from "./items.js";
import {
  describeSource,
  eventMsgPayloadSchema,
  isSubagentMeta,
  parseRolloutLine,
  sessionMetaPayloadSchema,
  turnContextPayloadSchema,
  type RolloutLine,
} from "./lines.js";

export interface CodexRolloutMeta {
  id: string;
  sessionId: string;
  parentThreadId: string | null;
  cwd: string;
  originator: string;
  source: string;
  timestamp: string | null;
  cliVersion: string | null;
  model: string | null;
  reasoningEffort: string | null;
  isSubagent: boolean;
}

export interface CodexRolloutTurnItem {
  ordinal: number;
  timestamp: string | null;
  item: CodexRolloutItem;
}

export interface CodexRolloutTurn {
  turnId: string;
  startedAt: string | null;
  firstOrdinal: number;
  lastOrdinal: number;
  items: CodexRolloutTurnItem[];
  skippedItemKinds: string[];
}

export interface CodexRollout {
  meta: CodexRolloutMeta;
  turns: CodexRolloutTurn[];
  lastOrdinal: number;
  format: "modern" | "legacy";
}

export class CodexRolloutParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodexRolloutParseError";
  }
}

interface TurnAccumulator {
  turnId: string;
  startedAt: string | null;
  firstOrdinal: number;
  lastOrdinal: number;
  items: CodexRolloutTurnItem[];
  skippedItemKinds: Set<string>;
}

function readMeta(line: RolloutLine): CodexRolloutMeta {
  const parsed = sessionMetaPayloadSchema.safeParse(line.payload);
  if (!parsed.success) {
    throw new CodexRolloutParseError("session_meta payload is malformed");
  }
  const meta = parsed.data;
  return {
    id: meta.id,
    sessionId: meta.session_id ?? meta.id,
    parentThreadId: meta.parent_thread_id ?? null,
    cwd: meta.cwd,
    originator: meta.originator,
    source: describeSource(meta.source),
    timestamp: meta.timestamp ?? line.timestamp,
    cliVersion: meta.cli_version ?? null,
    model: null,
    reasoningEffort: null,
    isSubagent: isSubagentMeta(meta),
  };
}

class RolloutBuilder {
  meta: CodexRolloutMeta | null = null;
  lastOrdinal = -1;
  private readonly turns = new Map<string, TurnAccumulator>();
  private readonly order: string[] = [];
  private currentTurnId: string | null = null;
  private legacyCounter = 0;
  private readonly modernItems: { turnId: string; line: RolloutLine }[] = [];
  private readonly legacyItems: { turnId: string; line: RolloutLine }[] = [];
  private readonly turnStarts = new Map<string, string | null>();

  private turn(turnId: string, line: RolloutLine): TurnAccumulator {
    let turn = this.turns.get(turnId);
    if (turn === undefined) {
      turn = {
        turnId,
        startedAt: this.turnStarts.get(turnId) ?? line.timestamp,
        firstOrdinal: line.ordinal,
        lastOrdinal: line.ordinal,
        items: [],
        skippedItemKinds: new Set(),
      };
      this.turns.set(turnId, turn);
      this.order.push(turnId);
    }
    turn.firstOrdinal = Math.min(turn.firstOrdinal, line.ordinal);
    turn.lastOrdinal = Math.max(turn.lastOrdinal, line.ordinal);
    return turn;
  }

  private implicitTurnId(line: RolloutLine): string {
    if (this.currentTurnId === null) {
      this.currentTurnId = `rollout-${line.ordinal}`;
    }
    return this.currentTurnId;
  }

  add(line: RolloutLine): void {
    this.lastOrdinal = Math.max(this.lastOrdinal, line.ordinal);
    switch (line.type) {
      case "session_meta":
        if (this.meta === null) this.meta = readMeta(line);
        return;
      case "turn_context": {
        const parsed = turnContextPayloadSchema.safeParse(line.payload);
        if (!parsed.success) return;
        if (parsed.data.turn_id) {
          this.currentTurnId = parsed.data.turn_id;
        } else if (this.currentTurnId === null) {
          this.currentTurnId = `rollout-${line.ordinal}`;
        }
        if (this.meta !== null) {
          this.meta.model = parsed.data.model ?? this.meta.model;
          this.meta.reasoningEffort =
            parsed.data.collaboration_mode?.settings?.reasoning_effort ??
            parsed.data.effort ??
            this.meta.reasoningEffort;
        }
        return;
      }
      case "event_msg": {
        const parsed = eventMsgPayloadSchema.safeParse(line.payload);
        if (!parsed.success) return;
        const payload = parsed.data;
        if (payload.type === "task_started") {
          const turnId = payload.turn_id ?? `rollout-${line.ordinal}`;
          this.currentTurnId = turnId;
          this.turnStarts.set(turnId, line.timestamp);
          return;
        }
        if (payload.type === "item_completed") {
          const turnId = payload.turn_id ?? this.implicitTurnId(line);
          this.currentTurnId = turnId;
          this.modernItems.push({ turnId, line });
        }
        return;
      }
      case "response_item":
        this.legacyItems.push({ turnId: this.implicitTurnId(line), line });
        return;
      default:
        return;
    }
  }

  private itemKindOf(line: RolloutLine): string | null {
    const parsed = eventMsgPayloadSchema.safeParse(line.payload);
    if (!parsed.success || parsed.data.type !== "item_completed") return null;
    const item = parsed.data.item;
    if (typeof item !== "object" || item === null || !("type" in item)) {
      return null;
    }
    return typeof item.type === "string" ? item.type : null;
  }

  private isModern(): boolean {
    return this.modernItems.some(({ line }) => {
      const kind = this.itemKindOf(line);
      return kind !== null && kind !== "UserMessage";
    });
  }

  private buildModern(): void {
    for (const { turnId, line } of this.modernItems) {
      const parsed = eventMsgPayloadSchema.safeParse(line.payload);
      if (!parsed.success || parsed.data.type !== "item_completed") continue;
      const turn = this.turn(turnId, line);
      const normalized = normalizeCodexItem(parsed.data.item);
      if (normalized.outcome === "skipped") {
        turn.skippedItemKinds.add(normalized.kind);
        continue;
      }
      turn.items.push({
        ordinal: line.ordinal,
        timestamp: line.timestamp,
        item: normalized.item,
      });
    }
  }

  private buildLegacy(): void {
    const userTurns = new Set<string>();
    for (const { turnId, line } of this.modernItems) {
      const parsed = eventMsgPayloadSchema.safeParse(line.payload);
      if (!parsed.success || parsed.data.type !== "item_completed") continue;
      const normalized = normalizeCodexItem(parsed.data.item);
      if (normalized.outcome !== "item") continue;
      const turn = this.turn(turnId, line);
      turn.items.push({
        ordinal: line.ordinal,
        timestamp: line.timestamp,
        item: normalized.item,
      });
      userTurns.add(turnId);
    }
    const pendingCommands = new Map<
      string,
      Extract<CodexRolloutItem, { type: "commandExecution" | "toolCall" }>
    >();
    for (const { turnId, line } of this.legacyItems) {
      this.legacyCounter += 1;
      const id = `rollout-item-${line.ordinal}-${this.legacyCounter}`;
      const normalized = normalizeLegacyResponseItem(line.payload, id);
      if (normalized.outcome === "skipped") {
        continue;
      }
      if (normalized.outcome === "output") {
        const target =
          normalized.callId === null
            ? undefined
            : pendingCommands.get(normalized.callId);
        if (target !== undefined) {
          if (target.type === "commandExecution") {
            target.aggregatedOutput = normalized.output;
          } else {
            target.result = normalized.output;
          }
          pendingCommands.delete(normalized.callId ?? "");
        }
        continue;
      }
      const item = normalized.item;
      if (item.type === "userMessage") {
        const hasModernUser = this.turns
          .get(turnId)
          ?.items.some((entry) => entry.item.type === "userMessage");
        if (hasModernUser || item.content.length === 0) continue;
        const text = item.content
          .map((part) => (part.type === "text" ? part.text : ""))
          .join("");
        if (text.startsWith("# AGENTS.md") || text.startsWith("<")) continue;
      }
      const turn = this.turn(turnId, line);
      turn.items.push({
        ordinal: line.ordinal,
        timestamp: line.timestamp,
        item,
      });
      if (item.type === "commandExecution" || item.type === "toolCall") {
        pendingCommands.set(item.id, item);
      }
    }
  }

  build(): CodexRollout {
    if (this.meta === null) {
      throw new CodexRolloutParseError("rollout has no session_meta line");
    }
    const modern = this.isModern();
    if (modern) {
      this.buildModern();
    } else {
      this.buildLegacy();
    }
    const turns = this.order
      .map((turnId) => this.turns.get(turnId))
      .filter((turn): turn is TurnAccumulator => turn !== undefined)
      .map((turn) => ({
        turnId: turn.turnId,
        startedAt: turn.startedAt,
        firstOrdinal: turn.firstOrdinal,
        lastOrdinal: turn.lastOrdinal,
        items: [...turn.items].sort((a, b) => a.ordinal - b.ordinal),
        skippedItemKinds: [...turn.skippedItemKinds].sort(),
      }))
      .sort((a, b) => a.firstOrdinal - b.firstOrdinal);
    return {
      meta: this.meta,
      turns,
      lastOrdinal: this.lastOrdinal,
      format: modern ? "modern" : "legacy",
    };
  }
}

export function parseRolloutText(text: string): CodexRollout {
  const builder = new RolloutBuilder();
  const rawLines = text.split("\n");
  for (const [index, raw] of rawLines.entries()) {
    const line = parseRolloutLine(raw, index);
    if (line !== null) builder.add(line);
  }
  return builder.build();
}

export async function parseRolloutFile(path: string): Promise<CodexRollout> {
  const builder = new RolloutBuilder();
  const reader = createInterface({
    input: createReadStream(path, { encoding: "utf8" }),
    crlfDelay: Number.POSITIVE_INFINITY,
  });
  let index = 0;
  for await (const raw of reader) {
    const line = parseRolloutLine(raw, index);
    index += 1;
    if (line !== null) builder.add(line);
  }
  return builder.build();
}

function rolloutFirstOrdinal(rollout: CodexRollout): number {
  return rollout.turns[0]?.firstOrdinal ?? rollout.lastOrdinal;
}

export function mergeRollouts(rollouts: readonly CodexRollout[]): CodexRollout {
  const [first, ...rest] = [...rollouts].sort(
    (a, b) => rolloutFirstOrdinal(a) - rolloutFirstOrdinal(b),
  );
  if (first === undefined) {
    throw new CodexRolloutParseError("no rollouts to merge");
  }
  const meta = { ...first.meta };
  const turnsById = new Map<string, CodexRolloutTurn>();
  let lastOrdinal = first.lastOrdinal;
  let modern = first.format === "modern";
  for (const rollout of [first, ...rest]) {
    for (const turn of rollout.turns) {
      if (!turnsById.has(turn.turnId)) turnsById.set(turn.turnId, turn);
    }
    lastOrdinal = Math.max(lastOrdinal, rollout.lastOrdinal);
    modern ||= rollout.format === "modern";
    meta.model = rollout.meta.model ?? meta.model;
    meta.reasoningEffort = rollout.meta.reasoningEffort ?? meta.reasoningEffort;
  }
  return {
    meta,
    turns: [...turnsById.values()].sort(
      (a, b) => a.firstOrdinal - b.firstOrdinal,
    ),
    lastOrdinal,
    format: modern ? "modern" : "legacy",
  };
}

export async function parseRolloutFiles(
  paths: readonly string[],
): Promise<CodexRollout> {
  return mergeRollouts(await Promise.all(paths.map(parseRolloutFile)));
}

export function rolloutFirstPrompt(rollout: CodexRollout): string | null {
  for (const turn of rollout.turns) {
    for (const entry of turn.items) {
      if (entry.item.type !== "userMessage") continue;
      const text = userMessageText(entry.item);
      if (text.length > 0) return text;
    }
  }
  return null;
}

export function userMessageText(
  item: Extract<CodexRolloutItem, { type: "userMessage" }>,
): string {
  return item.content
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
    .trim();
}
