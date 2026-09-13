import { z } from "zod";

const rolloutLineSchema = z.object({
  timestamp: z.string().optional(),
  ordinal: z.number().int().optional(),
  type: z.string(),
  payload: z.unknown(),
});

export interface RolloutLine {
  ordinal: number;
  timestamp: string | null;
  type: string;
  payload: unknown;
}

export function parseRolloutLine(
  raw: string,
  lineIndex: number,
): RolloutLine | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  let json: unknown;
  try {
    json = JSON.parse(trimmed);
  } catch {
    return null;
  }
  const parsed = rolloutLineSchema.safeParse(json);
  if (!parsed.success) return null;
  return {
    ordinal: parsed.data.ordinal ?? lineIndex,
    timestamp: parsed.data.timestamp ?? null,
    type: parsed.data.type,
    payload: parsed.data.payload,
  };
}

const subagentSourceSchema = z.object({ subagent: z.unknown() });

export const sessionMetaPayloadSchema = z.object({
  id: z.string().min(1),
  session_id: z.string().optional(),
  parent_thread_id: z.string().nullable().optional(),
  timestamp: z.string().optional(),
  cwd: z.string().default(""),
  originator: z.string().default(""),
  cli_version: z.string().optional(),
  source: z.union([z.string(), subagentSourceSchema, z.unknown()]).optional(),
});
export type SessionMetaPayload = z.infer<typeof sessionMetaPayloadSchema>;

export const turnContextPayloadSchema = z.object({
  turn_id: z.string().optional(),
  model: z.string().optional(),
  effort: z.string().nullable().optional(),
  collaboration_mode: z
    .object({
      settings: z
        .object({ reasoning_effort: z.string().nullable().optional() })
        .optional(),
    })
    .optional(),
});

export const eventMsgPayloadSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("task_started"),
    turn_id: z.string().optional(),
    started_at: z.number().optional(),
  }),
  z.object({
    type: z.literal("item_completed"),
    turn_id: z.string().optional(),
    item: z.unknown(),
    completed_at_ms: z.number().optional(),
  }),
  z.object({
    type: z.literal("task_complete"),
    turn_id: z.string().optional(),
  }),
  z.object({
    type: z.literal("turn_aborted"),
    turn_id: z.string().optional(),
  }),
]);

export function describeSource(source: SessionMetaPayload["source"]): string {
  if (typeof source === "string") return source;
  const subagent = subagentSourceSchema.safeParse(source);
  if (subagent.success) {
    const inner = subagent.data.subagent;
    if (typeof inner === "string") return `subagent:${inner}`;
    if (typeof inner === "object" && inner !== null) {
      const values = Object.values(inner).filter(
        (value): value is string => typeof value === "string",
      );
      return values.length > 0 ? `subagent:${values[0]}` : "subagent";
    }
    return "subagent";
  }
  return "unknown";
}

export function isSubagentMeta(meta: SessionMetaPayload): boolean {
  if (subagentSourceSchema.safeParse(meta.source).success) return true;
  const parent = meta.parent_thread_id;
  return typeof parent === "string" && parent.length > 0 && parent !== meta.id;
}
