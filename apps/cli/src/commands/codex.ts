import { Command } from "commander";
import type { CodexSession } from "@kaioken/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { outputJson, type JsonOutputOptions } from "./helpers.js";

interface CodexSessionListOptions extends JsonOutputOptions {
  archived?: boolean;
  limit?: string;
}

interface CodexSessionImportOptions extends JsonOutputOptions {
  project?: string;
}

const DEFAULT_LIST_LIMIT = 50;
const PROMPT_COLUMN_WIDTH = 60;

function parseLimit(value: string | undefined): number {
  if (value === undefined) return DEFAULT_LIST_LIMIT;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`--limit must be a positive integer, received "${value}".`);
  }
  return parsed;
}

function truncate(value: string, width: number): string {
  return value.length <= width ? value : `${value.slice(0, width - 1)}…`;
}

function formatDate(value: string | null, fallbackMs: number): string {
  const parsed = value === null ? Number.NaN : Date.parse(value);
  const date = Number.isFinite(parsed)
    ? new Date(parsed)
    : new Date(fallbackMs);
  return date.toISOString().slice(0, 10);
}

function shortenHome(pathValue: string): string {
  const home = process.env.HOME;
  return home && pathValue.startsWith(home)
    ? `~${pathValue.slice(home.length)}`
    : pathValue;
}

export function printCodexSessionTable(
  sessions: readonly CodexSession[],
): void {
  const rows = sessions.map((session) => [
    session.id,
    formatDate(session.createdAt, session.updatedAt),
    truncate(shortenHome(session.cwd), 40),
    truncate(
      session.name ?? session.firstPrompt ?? "(no prompt)",
      PROMPT_COLUMN_WIDTH,
    ),
    session.importedThreadId ?? (session.archived ? "archived" : "-"),
  ]);
  console.log(
    renderBorderlessTable(
      {
        head: ["ID", "Date", "Folder", "First prompt", "Imported as"],
        colWidths: [
          Math.max(2, ...rows.map((row) => row[0]!.length)),
          10,
          Math.max(6, ...rows.map((row) => row[2]!.length)),
          Math.max(12, ...rows.map((row) => row[3]!.length)),
          Math.max(11, ...rows.map((row) => row[4]!.length)),
        ],
        trimTrailingWhitespace: true,
      },
      rows,
    ),
  );
}

export function registerCodexCommands(
  program: Command,
  getUrl: () => string,
): void {
  const codex = program
    .command("codex")
    .description("Import and hand off Codex CLI sessions");
  const sessions = codex
    .command("sessions")
    .description("Browse the Codex sessions on this machine");

  sessions
    .command("list")
    .description("List top-level Codex sessions, newest first")
    .option("--archived", "Include Codex's archived sessions")
    .option("--limit <count>", "Maximum sessions to print (default 50)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: CodexSessionListOptions) => {
        const limit = parseLimit(opts.limit);
        const result = await createCliBbSdk(getUrl()).codex.sessions.list({
          includeArchived: opts.archived === true,
        });
        const sessions = result.sessions.slice(0, limit);
        if (outputJson(opts, { ...result, sessions })) return;
        if (sessions.length === 0) {
          console.log(`No Codex sessions found under ${result.sharedHome}`);
          return;
        }
        printCodexSessionTable(sessions);
        if (result.sessions.length > sessions.length) {
          console.log(
            `Showing ${sessions.length} of ${result.sessions.length}; pass --limit to see more.`,
          );
        }
      }),
    );

  sessions
    .command("import <session-id...>")
    .description("Import Codex sessions as Kaioken threads you can continue")
    .option(
      "--project <id>",
      "Project for the imported threads (defaults to the session folder's project)",
    )
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (ids: string[], opts: CodexSessionImportOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const threads = [];
        for (const id of ids) {
          const thread = await sdk.codex.sessions.import({
            id,
            ...(opts.project !== undefined ? { projectId: opts.project } : {}),
            origin: "cli",
          });
          threads.push(thread);
          if (!opts.json) {
            console.log(
              `${id} -> ${thread.id} (${thread.title ?? thread.titleFallback ?? "untitled"})`,
            );
          }
        }
        outputJson(opts, threads);
      }),
    );
}
