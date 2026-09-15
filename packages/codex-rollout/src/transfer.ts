import { randomUUID } from "node:crypto";
import { link, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

const lineSchema = z
  .object({
    type: z.string().min(1),
    ordinal: z.number().int().nonnegative().optional(),
    payload: z.unknown(),
  })
  .passthrough();
const metaSchema = z
  .object({
    id: z.string().uuid(),
    session_id: z.string().uuid().optional(),
    timestamp: z.string().optional(),
    cwd: z.string(),
  })
  .passthrough();
type NativeLine = z.infer<typeof lineSchema>;

export function prepareCodexSessionTransfer(args: {
  contents: readonly string[];
  sourceProviderThreadId: string;
  targetProviderThreadId: string;
  workspacePath: string;
}): string {
  z.string().uuid().parse(args.sourceProviderThreadId);
  z.string().uuid().parse(args.targetProviderThreadId);
  if (!path.isAbsolute(args.workspacePath))
    throw new Error("The destination workspace must be an absolute path");
  if (args.contents.length === 0)
    throw new Error("The Codex session has no rollout files");
  const segments = args.contents.map((content) => {
    const lines = content
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .map((line) => lineSchema.parse(JSON.parse(line)));
    const first = lines[0];
    if (first?.type !== "session_meta")
      throw new Error("The Codex rollout is missing its session header");
    for (const line of lines) {
      if (line.type !== "session_meta") continue;
      const meta = metaSchema.parse(line.payload);
      if (
        meta.id !== args.sourceProviderThreadId ||
        (meta.session_id !== undefined && meta.session_id !== meta.id)
      )
        throw new Error("The Codex rollout belongs to a different session");
    }
    return lines;
  });
  let lines: NativeLine[];
  if (segments.length === 1) {
    lines = segments[0]!;
  } else {
    const byOrdinal = new Map<number, NativeLine>();
    for (const segment of segments) {
      for (const line of segment) {
        if (line.ordinal === undefined)
          throw new Error(
            "Cannot safely merge Codex rollout segments without sequence numbers",
          );
        const existing = byOrdinal.get(line.ordinal);
        if (existing && JSON.stringify(existing) !== JSON.stringify(line))
          throw new Error(
            "Codex rollout segments contain conflicting sequence numbers",
          );
        byOrdinal.set(line.ordinal, line);
      }
    }
    lines = [...byOrdinal.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, line]) => line);
  }
  let hasHeader = false;
  const output: NativeLine[] = [];
  for (const line of lines) {
    if (line.type === "session_meta") {
      if (hasHeader) continue;
      hasHeader = true;
      const meta = metaSchema.parse(line.payload);
      output.push({
        ...line,
        payload: {
          ...meta,
          id: args.targetProviderThreadId,
          ...(meta.session_id === undefined
            ? {}
            : { session_id: args.targetProviderThreadId }),
          cwd: args.workspacePath,
        },
      });
    } else {
      output.push(
        line.thread_id === args.sourceProviderThreadId
          ? { ...line, thread_id: args.targetProviderThreadId }
          : line,
      );
    }
  }
  return output.map((line) => JSON.stringify(line)).join("\n") + "\n";
}

export async function installTransferredCodexSession(args: {
  codexHome: string;
  providerThreadId: string;
  contents: string;
}): Promise<string> {
  z.string().uuid().parse(args.providerThreadId);
  const header = lineSchema.parse(JSON.parse(args.contents.split("\n")[0]!));
  const meta = metaSchema.parse(header.payload);
  if (header.type !== "session_meta" || meta.id !== args.providerThreadId)
    throw new Error("The transferred Codex session identity does not match");
  const parsedDate =
    meta.timestamp === undefined ? NaN : Date.parse(meta.timestamp);
  const date = new Date(Number.isFinite(parsedDate) ? parsedDate : 0)
    .toISOString()
    .slice(0, 10);
  const directory = path.join(args.codexHome, "sessions", ...date.split("-"));
  const target = path.join(
    directory,
    `rollout-${date}-${args.providerThreadId}.jsonl`,
  );
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = path.join(
    directory,
    `.${args.providerThreadId}-${randomUUID()}.tmp`,
  );
  await writeFile(temporary, args.contents, { flag: "wx", mode: 0o600 });
  try {
    try {
      await link(temporary, target);
    } catch (error) {
      if (
        !(error instanceof Error && "code" in error && error.code === "EEXIST")
      )
        throw error;
      if ((await readFile(target, "utf8")) !== args.contents)
        throw new Error(
          "A different Codex session already occupies this transfer identity",
        );
    }
    return target;
  } finally {
    await unlink(temporary);
  }
}
