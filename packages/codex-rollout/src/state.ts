import Database from "better-sqlite3";
import { readdirSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

export interface CodexStateThread {
  id: string;
  rolloutPath: string;
  cwd: string;
  name: string | null;
  title: string | null;
  firstUserMessage: string | null;
  archived: boolean;
  pinned: boolean;
  section: string | null;
  project: string | null;
  createdAtMs: number | null;
  updatedAtMs: number | null;
  recencyAtMs: number | null;
  agentRole: string | null;
}

const STATE_FILE_PATTERN = /^state_(\d+)\.sqlite$/u;

const optionalText = z
  .union([z.string(), z.null()])
  .optional()
  .transform((value) => {
    const trimmed = value?.trim() ?? "";
    return trimmed.length > 0 ? trimmed : null;
  });
const optionalNumber = z
  .union([z.number(), z.null()])
  .optional()
  .transform((value) => (typeof value === "number" ? value : null));
const flag = z
  .union([z.number(), z.null()])
  .optional()
  .transform((value) => value === 1);

const rowSchema = z.object({
  id: z.string(),
  rollout_path: z.string().default(""),
  cwd: z.string().default(""),
  name: optionalText,
  title: optionalText,
  first_user_message: optionalText,
  archived: flag,
  is_pinned: flag,
  section: optionalText,
  project: optionalText,
  created_at_ms: optionalNumber,
  updated_at_ms: optionalNumber,
  recency_at_ms: optionalNumber,
  agent_role: optionalText,
});

const FULL_QUERY = `
  SELECT t.id, t.rollout_path, t.cwd, t.name, t.title, t.first_user_message,
         t.archived, t.is_pinned, s.name AS section, p.name AS project,
         t.created_at_ms, t.updated_at_ms, t.recency_at_ms, t.agent_role
  FROM threads t
  LEFT JOIN thread_sections s ON s.id = t.thread_section_id
  LEFT JOIN projects p ON p.id = t.project_id
`;
const MINIMAL_QUERY = `SELECT t.id, t.rollout_path, t.cwd, t.title, t.archived FROM threads t`;

export function findCodexStateDatabase(home: string): string | null {
  let entries: string[];
  try {
    entries = readdirSync(home);
  } catch {
    return null;
  }
  let best: { version: number; name: string } | null = null;
  for (const name of entries) {
    const match = STATE_FILE_PATTERN.exec(name);
    if (match === null) continue;
    const version = Number(match[1]);
    if (best === null || version > best.version) best = { version, name };
  }
  return best === null ? null : path.join(home, best.name);
}

function toThread(row: z.infer<typeof rowSchema>): CodexStateThread {
  return {
    id: row.id,
    rolloutPath: row.rollout_path,
    cwd: row.cwd,
    name: row.name,
    title: row.title,
    firstUserMessage: row.first_user_message,
    archived: row.archived,
    pinned: row.is_pinned,
    section: row.section,
    project: row.project,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms,
    recencyAtMs: row.recency_at_ms,
    agentRole: row.agent_role,
  };
}

function queryRows(
  database: Database.Database,
  sql: string,
  where: string,
  params: unknown[],
): CodexStateThread[] {
  const rows: unknown[] = database.prepare(`${sql} ${where}`).all(...params);
  const threads: CodexStateThread[] = [];
  for (const raw of rows) {
    const parsed = rowSchema.safeParse(raw);
    if (parsed.success) threads.push(toThread(parsed.data));
  }
  return threads;
}

function withDatabase<T>(
  home: string,
  read: (database: Database.Database) => T,
  fallback: T,
): T {
  const file = findCodexStateDatabase(home);
  if (file === null) return fallback;
  let database: Database.Database;
  try {
    database = new Database(file, { readonly: true, fileMustExist: true });
  } catch {
    return fallback;
  }
  try {
    return read(database);
  } catch {
    return fallback;
  } finally {
    database.close();
  }
}

function readThreads(
  database: Database.Database,
  where: string,
  params: unknown[],
): CodexStateThread[] {
  try {
    return queryRows(database, FULL_QUERY, where, params);
  } catch {
    return queryRows(database, MINIMAL_QUERY, where, params);
  }
}

export function readCodexStateThreads(
  home: string,
): Map<string, CodexStateThread> {
  return withDatabase(
    home,
    (database) =>
      new Map(readThreads(database, "", []).map((row) => [row.id, row])),
    new Map<string, CodexStateThread>(),
  );
}

export function readCodexStateThread(
  home: string,
  id: string,
): CodexStateThread | null {
  return withDatabase(
    home,
    (database) => readThreads(database, "WHERE t.id = ?", [id])[0] ?? null,
    null,
  );
}
