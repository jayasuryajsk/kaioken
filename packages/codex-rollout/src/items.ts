import { fileURLToPath } from "node:url";
import { z } from "zod";

export type CodexItemStatus =
  | "pending"
  | "completed"
  | "failed"
  | "interrupted";
export type CodexApprovalStatus = "waiting_for_approval" | "denied" | null;

export type CodexUserContent =
  | { type: "text"; text: string }
  | { type: "image"; url: string }
  | { type: "localImage"; path: string };

export interface CodexFileChange {
  path: string;
  kind: "add" | "delete" | "update";
  diff?: string;
  movePath?: string;
}

export type CodexRolloutItem =
  | { type: "userMessage"; id: string; content: CodexUserContent[] }
  | { type: "agentMessage"; id: string; text: string }
  | {
      type: "commandExecution";
      id: string;
      command: string;
      cwd: string;
      status: CodexItemStatus;
      approvalStatus: CodexApprovalStatus;
      aggregatedOutput?: string;
      exitCode?: number;
      durationMs?: number;
    }
  | {
      type: "fileChange";
      id: string;
      changes: CodexFileChange[];
      status: CodexItemStatus;
      approvalStatus: CodexApprovalStatus;
    }
  | {
      type: "toolCall";
      id: string;
      server?: string;
      tool: string;
      arguments?: Record<string, unknown>;
      status: CodexItemStatus;
      result?: unknown;
      error?: string;
      durationMs?: number;
    }
  | { type: "reasoning"; id: string; summary: string[]; content: string[] }
  | {
      type: "webSearch";
      id: string;
      queries: string[];
      resultText: string | null;
    }
  | { type: "imageView"; id: string; path: string }
  | { type: "contextCompaction"; id: string }
  | { type: "plan"; id: string; text: string };

export type CodexItemNormalization =
  | { outcome: "item"; item: CodexRolloutItem }
  | { outcome: "skipped"; kind: string };

const statusSchema = z.string().nullable().optional();

function mapStatus(raw: string | null | undefined): {
  status: CodexItemStatus;
  approvalStatus: CodexApprovalStatus;
} {
  switch ((raw ?? "completed").toLowerCase()) {
    case "completed":
    case "success":
      return { status: "completed", approvalStatus: null };
    case "failed":
    case "error":
      return { status: "failed", approvalStatus: null };
    case "declined":
    case "denied":
    case "rejected":
      return { status: "failed", approvalStatus: "denied" };
    case "interrupted":
    case "cancelled":
    case "canceled":
    case "aborted":
    case "in_progress":
    case "inprogress":
    case "pending":
      return { status: "interrupted", approvalStatus: null };
    default:
      return { status: "completed", approvalStatus: null };
  }
}

function shellQuote(argument: string): string {
  if (argument.length === 0) return "''";
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(argument)) return argument;
  return `'${argument.replaceAll("'", "'\\''")}'`;
}

export function formatCommand(command: unknown): string {
  if (typeof command === "string") return command;
  if (Array.isArray(command)) {
    return command
      .filter((part): part is string => typeof part === "string")
      .map(shellQuote)
      .join(" ");
  }
  return "";
}

export function normalizePath(value: unknown): string {
  if (typeof value !== "string") return "";
  if (value.startsWith("file://")) {
    try {
      return fileURLToPath(value);
    } catch {
      return value;
    }
  }
  return value;
}

const userContentSchema = z.array(
  z.union([
    z.object({ type: z.literal("text"), text: z.string() }),
    z.object({ type: z.literal("local_image"), path: z.string() }),
    z.object({ type: z.literal("image"), image_url: z.string() }),
    z.object({ type: z.string() }).passthrough(),
  ]),
);

const userMessageSchema = z.object({
  type: z.literal("UserMessage"),
  id: z.string(),
  content: userContentSchema.default([]),
});

const agentMessageSchema = z.object({
  type: z.literal("AgentMessage"),
  id: z.string(),
  content: z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .default([]),
});

const commandExecutionSchema = z.object({
  type: z.literal("CommandExecution"),
  id: z.string(),
  command: z.unknown(),
  cwd: z.unknown(),
  status: statusSchema,
  aggregated_output: z.string().nullable().optional(),
  stdout: z.string().nullable().optional(),
  stderr: z.string().nullable().optional(),
  exit_code: z.number().nullable().optional(),
  duration_ms: z.number().nullable().optional(),
  duration: z
    .union([
      z.number(),
      z.object({ secs: z.number(), nanos: z.number().optional() }),
    ])
    .nullable()
    .optional(),
});

const fileChangeEntrySchema = z.object({
  type: z.string().optional(),
  kind: z.string().optional(),
  content: z.string().nullable().optional(),
  unified_diff: z.string().nullable().optional(),
  diff: z.string().nullable().optional(),
  move_path: z.string().nullable().optional(),
});

const fileChangeSchema = z.object({
  type: z.literal("FileChange"),
  id: z.string(),
  changes: z
    .union([
      z.record(z.string(), fileChangeEntrySchema),
      z.array(fileChangeEntrySchema.extend({ path: z.string() })),
    ])
    .default({}),
  status: statusSchema,
});

const mcpToolCallSchema = z.object({
  type: z.literal("McpToolCall"),
  id: z.string(),
  server: z.string().optional(),
  tool: z.string(),
  arguments: z.record(z.string(), z.unknown()).nullable().optional(),
  status: statusSchema,
  result: z.unknown().optional(),
  error: z
    .union([z.string(), z.object({ message: z.string() })])
    .nullable()
    .optional(),
  duration: z
    .union([
      z.number(),
      z.object({ secs: z.number(), nanos: z.number().optional() }),
    ])
    .nullable()
    .optional(),
});

const reasoningSchema = z.object({
  type: z.literal("Reasoning"),
  id: z.string(),
  summary_text: z.array(z.string()).default([]),
  raw_content: z.array(z.string()).default([]),
});

const webSearchSchema = z.object({
  type: z.union([z.literal("WebSearch"), z.literal("Extension")]),
  id: z.string(),
  kind: z.string().optional(),
  query: z.string().nullable().optional(),
  action: z
    .object({
      query: z.string().nullable().optional(),
      queries: z.array(z.string()).nullable().optional(),
    })
    .nullable()
    .optional(),
});

const imageViewSchema = z.object({
  type: z.literal("ImageView"),
  id: z.string(),
  path: z.unknown(),
});

const contextCompactionSchema = z.object({
  type: z.literal("ContextCompaction"),
  id: z.string(),
});

const planSchema = z.object({
  type: z.literal("Plan"),
  id: z.string(),
  text: z.string().optional(),
  plan: z.string().optional(),
});

const itemTypeSchema = z.object({ type: z.string() });

function durationMs(
  duration:
    | number
    | { secs: number; nanos?: number | undefined }
    | null
    | undefined,
  explicit: number | null | undefined,
): number | undefined {
  if (typeof explicit === "number") return explicit;
  if (typeof duration === "number") return duration;
  if (duration && typeof duration === "object") {
    return Math.round(duration.secs * 1000 + (duration.nanos ?? 0) / 1e6);
  }
  return undefined;
}

function normalizeUserContent(
  content: z.infer<typeof userContentSchema>,
): CodexUserContent[] {
  const parts: CodexUserContent[] = [];
  for (const part of content) {
    if (
      part.type === "text" &&
      "text" in part &&
      typeof part.text === "string"
    ) {
      parts.push({ type: "text", text: part.text });
    } else if (part.type === "local_image" && "path" in part) {
      parts.push({ type: "localImage", path: String(part.path) });
    } else if (part.type === "image" && "image_url" in part) {
      parts.push({ type: "image", url: String(part.image_url) });
    }
  }
  return parts;
}

function normalizeFileChanges(
  changes: z.infer<typeof fileChangeSchema>["changes"],
): CodexFileChange[] {
  const entries = Array.isArray(changes)
    ? changes.map((entry) => [entry.path, entry] as const)
    : Object.entries(changes);
  return entries.map(([path, entry]) => {
    const rawKind = (entry.kind ?? entry.type ?? "update").toLowerCase();
    const kind: CodexFileChange["kind"] =
      rawKind === "add" || rawKind === "create"
        ? "add"
        : rawKind === "delete" || rawKind === "remove"
          ? "delete"
          : "update";
    const diff =
      entry.unified_diff ??
      entry.diff ??
      (kind === "add" && typeof entry.content === "string"
        ? entry.content
            .split("\n")
            .map((line) => `+${line}`)
            .join("\n")
        : null);
    return {
      path: normalizePath(path),
      kind,
      ...(typeof diff === "string" ? { diff } : {}),
      ...(typeof entry.move_path === "string"
        ? { movePath: normalizePath(entry.move_path) }
        : {}),
    };
  });
}

export function normalizeCodexItem(raw: unknown): CodexItemNormalization {
  const typed = itemTypeSchema.safeParse(raw);
  if (!typed.success) return { outcome: "skipped", kind: "malformed" };
  switch (typed.data.type) {
    case "UserMessage": {
      const parsed = userMessageSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "UserMessage" };
      return {
        outcome: "item",
        item: {
          type: "userMessage",
          id: parsed.data.id,
          content: normalizeUserContent(parsed.data.content),
        },
      };
    }
    case "AgentMessage": {
      const parsed = agentMessageSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "AgentMessage" };
      return {
        outcome: "item",
        item: {
          type: "agentMessage",
          id: parsed.data.id,
          text: parsed.data.content.map((part) => part.text ?? "").join(""),
        },
      };
    }
    case "CommandExecution": {
      const parsed = commandExecutionSchema.safeParse(raw);
      if (!parsed.success) {
        return { outcome: "skipped", kind: "CommandExecution" };
      }
      const status = mapStatus(parsed.data.status);
      const output =
        parsed.data.aggregated_output ??
        [parsed.data.stdout ?? "", parsed.data.stderr ?? ""]
          .filter((part) => part.length > 0)
          .join("\n");
      const duration = durationMs(
        parsed.data.duration,
        parsed.data.duration_ms,
      );
      return {
        outcome: "item",
        item: {
          type: "commandExecution",
          id: parsed.data.id,
          command: formatCommand(parsed.data.command),
          cwd: normalizePath(parsed.data.cwd),
          ...status,
          ...(output.length > 0 ? { aggregatedOutput: output } : {}),
          ...(typeof parsed.data.exit_code === "number"
            ? { exitCode: parsed.data.exit_code }
            : {}),
          ...(duration !== undefined ? { durationMs: duration } : {}),
        },
      };
    }
    case "FileChange": {
      const parsed = fileChangeSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "FileChange" };
      return {
        outcome: "item",
        item: {
          type: "fileChange",
          id: parsed.data.id,
          changes: normalizeFileChanges(parsed.data.changes),
          ...mapStatus(parsed.data.status),
        },
      };
    }
    case "McpToolCall": {
      const parsed = mcpToolCallSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "McpToolCall" };
      const error =
        typeof parsed.data.error === "string"
          ? parsed.data.error
          : parsed.data.error?.message;
      const duration = durationMs(parsed.data.duration, undefined);
      return {
        outcome: "item",
        item: {
          type: "toolCall",
          id: parsed.data.id,
          ...(parsed.data.server !== undefined
            ? { server: parsed.data.server }
            : {}),
          tool: parsed.data.tool,
          ...(parsed.data.arguments
            ? { arguments: parsed.data.arguments }
            : {}),
          status: mapStatus(parsed.data.status).status,
          ...(parsed.data.result !== undefined && parsed.data.result !== null
            ? { result: parsed.data.result }
            : {}),
          ...(error !== undefined ? { error } : {}),
          ...(duration !== undefined ? { durationMs: duration } : {}),
        },
      };
    }
    case "Reasoning": {
      const parsed = reasoningSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "Reasoning" };
      return {
        outcome: "item",
        item: {
          type: "reasoning",
          id: parsed.data.id,
          summary: parsed.data.summary_text,
          content: parsed.data.raw_content,
        },
      };
    }
    case "WebSearch":
    case "Extension": {
      const parsed = webSearchSchema.safeParse(raw);
      if (
        !parsed.success ||
        (parsed.data.type === "Extension" && parsed.data.kind !== "web.search")
      ) {
        return { outcome: "skipped", kind: typed.data.type };
      }
      const queries = [
        ...(parsed.data.action?.queries ?? []),
        ...(parsed.data.action?.query ? [parsed.data.action.query] : []),
        ...(parsed.data.query ? [parsed.data.query] : []),
      ];
      const unique = [...new Set(queries.filter((query) => query.length > 0))];
      if (unique.length === 0) {
        return { outcome: "skipped", kind: typed.data.type };
      }
      return {
        outcome: "item",
        item: {
          type: "webSearch",
          id: parsed.data.id,
          queries: unique,
          resultText: null,
        },
      };
    }
    case "ImageView": {
      const parsed = imageViewSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "ImageView" };
      return {
        outcome: "item",
        item: {
          type: "imageView",
          id: parsed.data.id,
          path: normalizePath(parsed.data.path),
        },
      };
    }
    case "ContextCompaction": {
      const parsed = contextCompactionSchema.safeParse(raw);
      if (!parsed.success) {
        return { outcome: "skipped", kind: "ContextCompaction" };
      }
      return {
        outcome: "item",
        item: { type: "contextCompaction", id: parsed.data.id },
      };
    }
    case "Plan": {
      const parsed = planSchema.safeParse(raw);
      const text = parsed.success ? (parsed.data.text ?? parsed.data.plan) : "";
      if (!parsed.success || !text) return { outcome: "skipped", kind: "Plan" };
      return {
        outcome: "item",
        item: { type: "plan", id: parsed.data.id, text },
      };
    }
    default:
      return { outcome: "skipped", kind: typed.data.type };
  }
}

const responseMessageSchema = z.object({
  type: z.literal("message"),
  role: z.string(),
  content: z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .default([]),
});

const responseReasoningSchema = z.object({
  type: z.literal("reasoning"),
  summary: z
    .array(z.object({ type: z.string(), text: z.string().optional() }))
    .default([]),
});

const responseFunctionCallSchema = z.object({
  type: z.literal("function_call"),
  name: z.string(),
  arguments: z.string().optional(),
  call_id: z.string().optional(),
});

const responseFunctionCallOutputSchema = z.object({
  type: z.literal("function_call_output"),
  call_id: z.string().optional(),
  output: z.unknown(),
});

const responseWebSearchSchema = z.object({
  type: z.literal("web_search_call"),
  status: statusSchema,
  action: z
    .object({
      query: z.string().nullable().optional(),
      queries: z.array(z.string()).nullable().optional(),
    })
    .nullable()
    .optional(),
});

export type LegacyResponseNormalization =
  | { outcome: "item"; item: CodexRolloutItem }
  | { outcome: "output"; callId: string | null; output: string }
  | { outcome: "skipped"; kind: string };

function shellCommandFromArguments(raw: string | undefined): string | null {
  if (raw === undefined) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== "object" || parsed === null) return null;
    const record = parsed as Record<string, unknown>;
    const command = record.cmd ?? record.command;
    if (typeof command === "string") return command;
    if (Array.isArray(command)) return formatCommand(command);
    return null;
  } catch {
    return null;
  }
}

export function normalizeLegacyResponseItem(
  raw: unknown,
  id: string,
): LegacyResponseNormalization {
  const typed = itemTypeSchema.safeParse(raw);
  if (!typed.success) return { outcome: "skipped", kind: "malformed" };
  switch (typed.data.type) {
    case "message": {
      const parsed = responseMessageSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "message" };
      const text = parsed.data.content
        .filter(
          (part) => part.type === "output_text" || part.type === "input_text",
        )
        .map((part) => part.text ?? "")
        .join("");
      if (parsed.data.role === "assistant") {
        return {
          outcome: "item",
          item: { type: "agentMessage", id, text },
        };
      }
      if (parsed.data.role === "user") {
        return {
          outcome: "item",
          item: {
            type: "userMessage",
            id,
            content: text.length > 0 ? [{ type: "text", text }] : [],
          },
        };
      }
      return { outcome: "skipped", kind: `message:${parsed.data.role}` };
    }
    case "reasoning": {
      const parsed = responseReasoningSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "reasoning" };
      return {
        outcome: "item",
        item: {
          type: "reasoning",
          id,
          summary: parsed.data.summary
            .map((part) => part.text ?? "")
            .filter((text) => text.length > 0),
          content: [],
        },
      };
    }
    case "function_call": {
      const parsed = responseFunctionCallSchema.safeParse(raw);
      if (!parsed.success) return { outcome: "skipped", kind: "function_call" };
      const callId = parsed.data.call_id ?? id;
      const command = shellCommandFromArguments(parsed.data.arguments);
      if (command !== null) {
        return {
          outcome: "item",
          item: {
            type: "commandExecution",
            id: callId,
            command,
            cwd: "",
            status: "completed",
            approvalStatus: null,
          },
        };
      }
      let parsedArguments: Record<string, unknown> | undefined;
      try {
        const value: unknown = JSON.parse(parsed.data.arguments ?? "{}");
        if (
          typeof value === "object" &&
          value !== null &&
          !Array.isArray(value)
        ) {
          parsedArguments = value as Record<string, unknown>;
        }
      } catch {
        parsedArguments = undefined;
      }
      return {
        outcome: "item",
        item: {
          type: "toolCall",
          id: callId,
          tool: parsed.data.name,
          ...(parsedArguments !== undefined
            ? { arguments: parsedArguments }
            : {}),
          status: "completed",
        },
      };
    }
    case "function_call_output": {
      const parsed = responseFunctionCallOutputSchema.safeParse(raw);
      if (!parsed.success) {
        return { outcome: "skipped", kind: "function_call_output" };
      }
      const output =
        typeof parsed.data.output === "string"
          ? parsed.data.output
          : JSON.stringify(parsed.data.output ?? "");
      return {
        outcome: "output",
        callId: parsed.data.call_id ?? null,
        output,
      };
    }
    case "web_search_call": {
      const parsed = responseWebSearchSchema.safeParse(raw);
      if (!parsed.success) {
        return { outcome: "skipped", kind: "web_search_call" };
      }
      const queries = [
        ...(parsed.data.action?.queries ?? []),
        ...(parsed.data.action?.query ? [parsed.data.action.query] : []),
      ];
      const unique = [...new Set(queries.filter((query) => query.length > 0))];
      if (unique.length === 0) {
        return { outcome: "skipped", kind: "web_search_call" };
      }
      return {
        outcome: "item",
        item: { type: "webSearch", id, queries: unique, resultText: null },
      };
    }
    default:
      return { outcome: "skipped", kind: typed.data.type };
  }
}
