import { homedir } from "node:os";
import path from "node:path";
import {
  copyRolloutsToHome,
  findRolloutsInHomes,
  isExistingDirectory,
  lastRolloutOrdinal,
  listRolloutFiles,
  mergeRollouts,
  mergeRolloutSummaries,
  parseRolloutFiles,
  parseRolloutText,
  readRolloutSummary,
  resolveCodexHomes,
  rolloutFirstPrompt,
  userMessageText,
  type CodexHomes,
  type CodexRollout,
  type CodexRolloutItem,
  type CodexRolloutTurn,
  readCodexStateThread,
  readCodexStateThreads,
} from "@kaioken/codex-rollout";
import {
  ensurePersonalProject,
  findOrCreateProjectByLocalPathSource,
  getEnvironment,
  getHost,
  getLiveThreadIdBySourceProviderThreadId,
  getPublicProjectByLocalPathSource,
  getThread,
  getThreadCodexLink,
  hasStoredTurnStarted,
  listLiveThreadIdsBySourceProviderThreadIds,
  listProjectSourcesByHost,
  setThreadCodexLink,
  type AppendStoredThreadEventArgs,
  type DbTransaction,
} from "@kaioken/db";
import {
  PERSONAL_PROJECT_ID,
  reasoningLevelSchema,
  threadScope,
  turnScope,
  type PromptInput,
  type ReasoningLevel,
  type ResolvedThreadExecutionOptions,
  type Thread,
  type ThreadEventItem,
  type ThreadEventType,
  type ThreadHandoffState,
} from "@kaioken/domain";
import type {
  CreateThreadEnvironmentArgs,
  ThreadCreateOrigin,
} from "@kaioken/server-contract";
import { ApiError } from "../../errors.js";
import type { LoggedPendingInteractionWorkSessionDeps } from "../../types.js";
import { callHostRetryableOnlineRpc } from "../hosts/online-rpc.js";
import {
  requirePrimaryHostId,
  resolvePrimaryHostId,
} from "../hosts/primary-host.js";
import {
  requirePublicProject,
  requirePublicThread,
} from "../lib/entity-lookup.js";
import { createThreadFromRequest } from "../threads/thread-create.js";
import {
  appendClientTurnEventInTransaction,
  appendThreadEventsInTransaction,
  getLastProviderThreadId,
} from "../threads/thread-events.js";

export const CODEX_PROVIDER_ID = "codex";
const KAIOKEN_ORIGINATOR = "kaioken";
const TITLE_MAX_LENGTH = 80;
const DEFAULT_IMPORT_MODEL = "gpt-5";
const DEFAULT_IMPORT_REASONING: ReasoningLevel = "medium";

type CodexSessionsDeps = LoggedPendingInteractionWorkSessionDeps;

export interface CodexSessionListItem {
  id: string;
  path: string;
  cwd: string;
  originator: string;
  source: string;
  createdAt: string | null;
  updatedAt: number;
  firstPrompt: string | null;
  name: string | null;
  pinned: boolean;
  section: string | null;
  archived: boolean;
  importedThreadId: string | null;
}

export interface CodexSessionList {
  sessions: CodexSessionListItem[];
  sharedHome: string;
  privateHome: string;
}

export interface CodexThreadLink {
  threadId: string;
  providerThreadId: string | null;
  sourceProviderThreadId: string | null;
  handoffState: ThreadHandoffState | null;
  sourceSyncedOrdinal: number | null;
}

export interface CodexHandoffOutcome {
  threadId: string;
  providerThreadId: string;
  rolloutPath: string;
  command: string;
  hostId: string | null;
  hostName: string | null;
  hostIsServer: boolean;
}

interface RolloutHost {
  hostId: string | null;
  hostName: string | null;
  remote: boolean;
}

const CODEX_ROLLOUT_RPC_TIMEOUT_MS = 30_000;

export interface CodexSyncOutcome {
  threadId: string;
  providerThreadId: string;
  rolloutPath: string;
  appendedTurns: number;
  appendedEvents: number;
}

export interface ImportCodexSessionOutcome {
  thread: Thread;
  created: boolean;
  importedTurns: number;
  importedEvents: number;
}

export function defaultCodexHomes(): CodexHomes {
  return resolveCodexHomes({ env: process.env, homeDir: homedir() });
}

export function listCodexSessions(
  deps: Pick<CodexSessionsDeps, "db">,
  args: { includeArchived: boolean; homes?: CodexHomes },
): CodexSessionList {
  const homes = args.homes ?? defaultCodexHomes();
  const summaries = listRolloutFiles(homes.shared, {
    includeArchived: args.includeArchived,
  }).flatMap((file) => {
    const summary = readRolloutSummary(file.path, { archived: file.archived });
    if (
      summary === null ||
      summary.isSubagent ||
      summary.originator === KAIOKEN_ORIGINATOR
    ) {
      return [];
    }
    return [summary];
  });
  const state = readCodexStateThreads(homes.shared);
  const merged = mergeRolloutSummaries(summaries).filter((summary) => {
    const known = state.get(summary.id);
    if (known === undefined) return true;
    if (known.agentRole !== null) return false;
    return args.includeArchived || !known.archived;
  });
  const imported = listLiveThreadIdsBySourceProviderThreadIds(
    deps.db,
    merged.map((summary) => summary.id),
  );
  const sessions = merged
    .map((summary): CodexSessionListItem => {
      const known = state.get(summary.id);
      return {
        id: summary.id,
        path: summary.path,
        cwd: summary.cwd,
        originator: summary.originator,
        source: summary.source,
        createdAt: summary.createdAt,
        updatedAt: Math.max(
          summary.updatedAt,
          known?.recencyAtMs ?? 0,
          known?.updatedAtMs ?? 0,
        ),
        firstPrompt: summary.firstPrompt ?? known?.firstUserMessage ?? null,
        name: known?.name ?? null,
        pinned: known?.pinned ?? false,
        section: known?.section ?? null,
        archived: summary.archived || (known?.archived ?? false),
        importedThreadId: imported.get(summary.id) ?? null,
      };
    })
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) || b.updatedAt - a.updatedAt,
    );
  return { sessions, sharedHome: homes.shared, privateHome: homes.private };
}

function resolveImportTarget(
  deps: Pick<CodexSessionsDeps, "db" | "hub" | "config">,
  args: { cwd: string; projectId: string | undefined },
): { projectId: string; environment: CreateThreadEnvironmentArgs } {
  const hostId = requirePrimaryHostId(deps);
  const cwd = args.cwd.length > 0 ? path.resolve(args.cwd) : "";
  if (args.projectId !== undefined) {
    const project = requirePublicProject(deps.db, args.projectId);
    if (project.kind === "personal") {
      return {
        projectId: project.id,
        environment: { type: "project-default" },
      };
    }
    const source = listProjectSourcesByHost(deps.db, hostId).find(
      (candidate) => candidate.projectId === project.id,
    );
    if (source === undefined) {
      throw new ApiError(
        400,
        "invalid_request",
        `Project ${project.id} has no checkout on the local host`,
      );
    }
    return {
      projectId: project.id,
      environment: {
        type: "host",
        hostId,
        workspace: { type: "unmanaged", path: source.path },
      },
    };
  }
  if (cwd.length > 0) {
    const existing = getPublicProjectByLocalPathSource(deps.db, {
      type: "local_path",
      hostId,
      path: cwd,
    });
    if (existing !== null) {
      return {
        projectId: existing.id,
        environment: {
          type: "host",
          hostId,
          workspace: { type: "unmanaged", path: cwd },
        },
      };
    }
    const ancestor = listProjectSourcesByHost(deps.db, hostId)
      .filter((source) => {
        const relative = path.relative(source.path, cwd);
        return (
          relative.length > 0 &&
          !relative.startsWith("..") &&
          !path.isAbsolute(relative)
        );
      })
      .sort((a, b) => b.path.length - a.path.length)[0];
    if (ancestor !== undefined) {
      return {
        projectId: ancestor.projectId,
        environment: {
          type: "host",
          hostId,
          workspace: { type: "unmanaged", path: ancestor.path },
        },
      };
    }
    if (isExistingDirectory(cwd)) {
      const { project } = findOrCreateProjectByLocalPathSource(
        deps.db,
        deps.hub,
        {
          name: path.basename(cwd) || cwd,
          source: { type: "local_path", hostId, path: cwd },
        },
      );
      return {
        projectId: project.id,
        environment: {
          type: "host",
          hostId,
          workspace: { type: "unmanaged", path: cwd },
        },
      };
    }
  }
  ensurePersonalProject(deps.db);
  return {
    projectId: PERSONAL_PROJECT_ID,
    environment: { type: "project-default" },
  };
}

function deriveImportTitle(prompt: string | null, fallback: string): string {
  const text = (prompt ?? "").replace(/\s+/g, " ").trim();
  if (text.length === 0) return fallback;
  return text.length <= TITLE_MAX_LENGTH
    ? text
    : `${text.slice(0, TITLE_MAX_LENGTH - 3)}...`;
}

function reasoningLevelFor(effort: string | null): ReasoningLevel | undefined {
  if (effort === null) return undefined;
  const parsed = reasoningLevelSchema.safeParse(effort.toLowerCase());
  return parsed.success ? parsed.data : undefined;
}

function promptInputsFor(
  items: readonly Extract<CodexRolloutItem, { type: "userMessage" }>[],
): PromptInput[] {
  const inputs: PromptInput[] = [];
  for (const item of items) {
    for (const part of item.content) {
      if (part.type === "text") {
        if (part.text.length > 0) {
          inputs.push({ type: "text", text: part.text, mentions: [] });
        }
      } else if (part.type === "localImage") {
        inputs.push({ type: "localImage", path: part.path });
      } else if (/^https?:\/\//.test(part.url)) {
        inputs.push({ type: "image", url: part.url });
      }
    }
  }
  return inputs;
}

function toThreadEventItem(item: CodexRolloutItem): ThreadEventItem | null {
  switch (item.type) {
    case "userMessage":
      return null;
    case "agentMessage":
      return item.text.length > 0
        ? { type: "agentMessage", id: item.id, text: item.text }
        : null;
    case "commandExecution":
      return {
        type: "commandExecution",
        id: item.id,
        command: item.command,
        cwd: item.cwd,
        status: item.status,
        approvalStatus: item.approvalStatus,
        ...(item.aggregatedOutput !== undefined
          ? { aggregatedOutput: item.aggregatedOutput }
          : {}),
        ...(item.exitCode !== undefined ? { exitCode: item.exitCode } : {}),
        ...(item.durationMs !== undefined
          ? { durationMs: item.durationMs }
          : {}),
      };
    case "fileChange":
      return {
        type: "fileChange",
        id: item.id,
        changes: item.changes.map((change) => ({
          path: change.path,
          kind: change.kind,
          ...(change.diff !== undefined ? { diff: change.diff } : {}),
          ...(change.movePath !== undefined
            ? { movePath: change.movePath }
            : {}),
        })),
        status: item.status,
        approvalStatus: item.approvalStatus,
      };
    case "toolCall":
      return {
        type: "toolCall",
        id: item.id,
        ...(item.server !== undefined ? { server: item.server } : {}),
        tool: item.tool,
        ...(item.arguments !== undefined ? { arguments: item.arguments } : {}),
        status: item.status,
        ...(item.result !== undefined ? { result: item.result } : {}),
        ...(item.error !== undefined ? { error: item.error } : {}),
        ...(item.durationMs !== undefined
          ? { durationMs: item.durationMs }
          : {}),
      };
    case "reasoning":
      return item.summary.length > 0 || item.content.length > 0
        ? {
            type: "reasoning",
            id: item.id,
            summary: item.summary,
            content: item.content,
          }
        : null;
    case "webSearch":
      return {
        type: "webSearch",
        id: item.id,
        queries: item.queries,
        resultText: item.resultText,
      };
    case "imageView":
      return { type: "imageView", id: item.id, path: item.path };
    case "contextCompaction":
      return { type: "contextCompaction", id: item.id };
    case "plan":
      return { type: "plan", id: item.id, text: item.text };
  }
}

function timestampMs(value: string | null, fallback: number): number {
  if (value === null) return fallback;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

interface AppendTurnsArgs {
  execution: ResolvedThreadExecutionOptions;
  providerThreadId: string;
  thread: Pick<Thread, "environmentId" | "id">;
  turns: readonly CodexRolloutTurn[];
  withIdentity: boolean;
}

interface AppendTurnsResult {
  eventTypes: ThreadEventType[];
  appendedEvents: number;
  appendedTurns: number;
}

function appendRolloutTurnsInTransaction(
  tx: DbTransaction,
  args: AppendTurnsArgs,
): AppendTurnsResult {
  const now = Date.now();
  const eventTypes = new Set<ThreadEventType>();
  let appendedEvents = 0;
  let appendedTurns = 0;
  const base = {
    threadId: args.thread.id,
    environmentId: args.thread.environmentId,
    providerThreadId: args.providerThreadId,
  };
  if (args.withIdentity) {
    appendThreadEventsInTransaction(tx, [
      {
        ...base,
        type: "thread/identity",
        scope: threadScope(),
        data: { providerThreadId: args.providerThreadId },
        createdAt: timestampMs(args.turns[0]?.startedAt ?? null, now),
      },
    ]);
    eventTypes.add("thread/identity");
    appendedEvents += 1;
  }
  for (const turn of args.turns) {
    const userItems = turn.items.flatMap((entry) =>
      entry.item.type === "userMessage" ? [entry.item] : [],
    );
    const input = promptInputsFor(userItems);
    const turnCreatedAt = timestampMs(
      turn.startedAt ?? turn.items[0]?.timestamp ?? null,
      now,
    );
    const rows: AppendStoredThreadEventArgs[] = [];
    rows.push({
      ...base,
      type: "turn/started",
      scope: turnScope(turn.turnId),
      data: { providerThreadId: args.providerThreadId },
      createdAt: turnCreatedAt,
    });
    if (input.length > 0) {
      const request = appendClientTurnEventInTransaction(tx, {
        threadId: args.thread.id,
        environmentId: args.thread.environmentId,
        type: "client/turn/requested",
        input,
        execution: args.execution,
        initiator: "user",
        senderThreadId: null,
        requestMethod: "turn/start",
        source: "tell",
        target: { kind: "new-turn" },
        createdAt: turnCreatedAt,
      });
      eventTypes.add("client/turn/requested");
      appendedEvents += 1;
      rows.push({
        ...base,
        type: "turn/input/accepted",
        scope: turnScope(turn.turnId),
        data: {
          providerThreadId: args.providerThreadId,
          clientRequestId: request.requestId,
        },
        createdAt: turnCreatedAt,
      });
    }
    let lastItemAt = turnCreatedAt;
    for (const entry of turn.items) {
      const item = toThreadEventItem(entry.item);
      if (item === null) continue;
      lastItemAt = timestampMs(entry.timestamp, lastItemAt);
      rows.push({
        ...base,
        type: "item/completed",
        scope: turnScope(turn.turnId),
        data: { providerThreadId: args.providerThreadId, item },
        createdAt: lastItemAt,
      });
    }
    rows.push({
      ...base,
      type: "turn/completed",
      scope: turnScope(turn.turnId),
      data: { providerThreadId: args.providerThreadId, status: "completed" },
      createdAt: lastItemAt,
    });
    appendThreadEventsInTransaction(tx, rows);
    for (const row of rows) eventTypes.add(row.type);
    appendedEvents += rows.length;
    appendedTurns += 1;
  }
  return { eventTypes: [...eventTypes], appendedEvents, appendedTurns };
}

function importExecutionFor(
  rollout: CodexRollout,
): ResolvedThreadExecutionOptions {
  return {
    model: rollout.meta.model ?? DEFAULT_IMPORT_MODEL,
    reasoningLevel:
      reasoningLevelFor(rollout.meta.reasoningEffort) ??
      DEFAULT_IMPORT_REASONING,
    permissionMode: "full",
    serviceTier: "default",
    source: "client/turn/requested",
  };
}

export function requireCodexProviderId(providerId: string): string {
  if (providerId !== CODEX_PROVIDER_ID)
    throw new ApiError(
      400,
      "codex_thread_required",
      "This action requires a native Codex session",
    );
  return providerId;
}

export function requireCodexThread(
  deps: Pick<CodexSessionsDeps, "db">,
  threadId: string,
): Thread {
  const thread = requirePublicThread(deps.db, threadId);
  requireCodexProviderId(thread.providerId);
  return thread;
}

function requireSettledThread(thread: Thread): void {
  if (thread.status !== "idle" && thread.status !== "error") {
    throw new ApiError(
      409,
      "thread_busy",
      `Thread ${thread.id} is ${thread.status}; wait for it to settle first`,
    );
  }
}

function requireProviderThreadId(
  deps: Pick<CodexSessionsDeps, "db">,
  thread: Thread,
): string {
  const link = getThreadCodexLink(deps.db, thread.id);
  const providerThreadId =
    link?.sourceProviderThreadId ?? getLastProviderThreadId(deps, thread.id);
  if (providerThreadId === null) {
    throw new ApiError(
      400,
      "codex_session_unavailable",
      `Thread ${thread.id} has no Codex session yet`,
    );
  }
  return providerThreadId;
}

export function getCodexThreadLink(
  deps: Pick<CodexSessionsDeps, "db">,
  threadId: string,
): CodexThreadLink {
  const thread = requirePublicThread(deps.db, threadId);
  const link = getThreadCodexLink(deps.db, thread.id);
  return {
    threadId: thread.id,
    providerThreadId:
      thread.providerId === CODEX_PROVIDER_ID
        ? (link?.sourceProviderThreadId ??
          getLastProviderThreadId(deps, thread.id))
        : null,
    sourceProviderThreadId: link?.sourceProviderThreadId ?? null,
    handoffState: link?.handoffState ?? null,
    sourceSyncedOrdinal: link?.sourceSyncedOrdinal ?? null,
  };
}

export async function importCodexSession(
  deps: CodexSessionsDeps,
  args: {
    id: string;
    projectId?: string;
    origin: ThreadCreateOrigin;
    homes?: CodexHomes;
  },
): Promise<ImportCodexSessionOutcome> {
  const homes = args.homes ?? defaultCodexHomes();
  const existingId = getLiveThreadIdBySourceProviderThreadId(deps.db, args.id);
  if (existingId !== null) {
    const existing = getThread(deps.db, existingId);
    if (existing !== null) {
      return {
        thread: existing,
        created: false,
        importedTurns: 0,
        importedEvents: 0,
      };
    }
  }
  const files = findRolloutsInHomes(homes, args.id, ["shared", "private"]);
  if (files === null) {
    throw new ApiError(
      404,
      "codex_session_not_found",
      `No Codex session ${args.id} under ${homes.shared}`,
    );
  }
  const rollout = await parseRolloutFiles(files.paths);
  if (rollout.meta.isSubagent) {
    throw new ApiError(
      400,
      "invalid_request",
      `Codex session ${args.id} is a subagent session and cannot be imported on its own`,
    );
  }
  const target = resolveImportTarget(deps, {
    cwd: rollout.meta.cwd,
    projectId: args.projectId,
  });
  const firstPrompt = rolloutFirstPrompt(rollout);
  const execution = importExecutionFor(rollout);
  const reasoningLevel = reasoningLevelFor(rollout.meta.reasoningEffort);
  let imported: AppendTurnsResult = {
    eventTypes: [],
    appendedEvents: 0,
    appendedTurns: 0,
  };
  const thread = await createThreadFromRequest(
    deps,
    {
      environment: target.environment,
      input: [],
      origin: args.origin,
      projectId: target.projectId,
      providerId: CODEX_PROVIDER_ID,
      startedOnBehalfOf: null,
      title:
        readCodexStateThread(homes.shared, args.id)?.name ??
        deriveImportTitle(firstPrompt, `Codex session ${args.id}`),
      ...(rollout.meta.model !== null ? { model: rollout.meta.model } : {}),
      ...(reasoningLevel !== undefined ? { reasoningLevel } : {}),
    },
    {
      providerInput: [],
      seedWithoutRun: true,
      onCreated: (created) => {
        imported = deps.db.transaction(
          (tx) => {
            const result = appendRolloutTurnsInTransaction(tx, {
              execution,
              providerThreadId: rollout.meta.id,
              thread: created,
              turns: rollout.turns,
              withIdentity: true,
            });
            setThreadCodexLink(tx, {
              threadId: created.id,
              sourceProviderThreadId: rollout.meta.id,
              handoffState: null,
              sourceSyncedOrdinal: rollout.lastOrdinal,
            });
            return result;
          },
          { behavior: "immediate" },
        );
      },
    },
  );
  if (files.home !== homes.private) {
    copyRolloutsToHome(files, homes.private);
  }
  deps.hub.notifyThread(thread.id, ["events-appended"], {
    eventTypes: imported.eventTypes,
  });
  return {
    thread,
    created: true,
    importedTurns: imported.appendedTurns,
    importedEvents: imported.appendedEvents,
  };
}

function resolveRolloutHost(
  deps: CodexSessionsDeps,
  thread: Thread,
): RolloutHost {
  const primaryHostId = resolvePrimaryHostId(deps);
  const environment =
    thread.environmentId === null
      ? null
      : getEnvironment(deps.db, thread.environmentId);
  const hostId = environment?.hostId ?? primaryHostId;
  const host = hostId === null ? null : getHost(deps.db, hostId);
  return {
    hostId,
    hostName: host?.name ?? null,
    remote: hostId !== null && hostId !== primaryHostId,
  };
}

function rolloutMissingError(
  providerThreadId: string,
  where: string,
): ApiError {
  return new ApiError(
    404,
    "codex_session_not_found",
    `No rollout for Codex session ${providerThreadId} ${where}`,
  );
}

async function callRolloutHost<
  TCommand extends
    | { type: "codex.rollouts.locate" }
    | { type: "codex.rollouts.copy" }
    | { type: "codex.rollouts.read" },
>(
  deps: CodexSessionsDeps,
  hostId: string,
  command: Parameters<typeof callHostRetryableOnlineRpc>[1]["command"] &
    TCommand,
) {
  return callHostRetryableOnlineRpc(deps, {
    hostId,
    timeoutMs: CODEX_ROLLOUT_RPC_TIMEOUT_MS,
    command,
  });
}

export async function handoffCodexSession(
  deps: CodexSessionsDeps,
  args: { threadId: string; homes?: CodexHomes },
): Promise<CodexHandoffOutcome> {
  const homes = args.homes ?? defaultCodexHomes();
  const thread = requireCodexThread(deps, args.threadId);
  requireSettledThread(thread);
  const providerThreadId = requireProviderThreadId(deps, thread);
  const rolloutHost = resolveRolloutHost(deps, thread);
  let rolloutPath: string;
  let lastOrdinal: number;
  if (rolloutHost.remote && rolloutHost.hostId !== null) {
    const hostLabel = rolloutHost.hostName ?? rolloutHost.hostId;
    const located = await callRolloutHost(deps, rolloutHost.hostId, {
      type: "codex.rollouts.locate",
      providerThreadId,
      homes: ["private", "shared"],
    });
    if (located.rollouts === null) {
      throw rolloutMissingError(providerThreadId, `on ${hostLabel}`);
    }
    const copied = await callRolloutHost(deps, rolloutHost.hostId, {
      type: "codex.rollouts.copy",
      providerThreadId,
      from: located.rollouts.home,
      to: "shared",
    });
    if (copied.copied === null) {
      throw rolloutMissingError(providerThreadId, `on ${hostLabel}`);
    }
    rolloutPath = copied.copied.paths[copied.copied.paths.length - 1] ?? "";
    lastOrdinal = copied.copied.lastOrdinal;
  } else {
    const files = findRolloutsInHomes(homes, providerThreadId, [
      "private",
      "shared",
    ]);
    if (files === null) {
      throw rolloutMissingError(providerThreadId, `under ${homes.private}`);
    }
    const copied = copyRolloutsToHome(files, homes.shared);
    rolloutPath = copied[copied.length - 1] ?? files.paths[0] ?? "";
    lastOrdinal = lastRolloutOrdinal(copied);
  }
  setThreadCodexLink(deps.db, {
    threadId: thread.id,
    sourceProviderThreadId: providerThreadId,
    handoffState: "handed-off",
    sourceSyncedOrdinal: lastOrdinal,
  });
  deps.hub.notifyThread(thread.id, ["title-changed"], {});
  return {
    threadId: thread.id,
    providerThreadId,
    rolloutPath,
    command: `codex resume ${providerThreadId}`,
    hostId: rolloutHost.hostId,
    hostName: rolloutHost.hostName,
    hostIsServer: !rolloutHost.remote,
  };
}

export async function syncCodexSession(
  deps: CodexSessionsDeps,
  args: { threadId: string; homes?: CodexHomes },
): Promise<CodexSyncOutcome> {
  const homes = args.homes ?? defaultCodexHomes();
  const thread = requireCodexThread(deps, args.threadId);
  requireSettledThread(thread);
  const providerThreadId = requireProviderThreadId(deps, thread);
  const link = getThreadCodexLink(deps.db, thread.id);
  if (link === null || link.sourceSyncedOrdinal === null) {
    throw new ApiError(
      409,
      "codex_sync_not_ready",
      `Thread ${thread.id} was never imported from or handed off to Codex`,
    );
  }
  const rolloutHost = resolveRolloutHost(deps, thread);
  const remoteHostId =
    rolloutHost.remote && rolloutHost.hostId !== null
      ? rolloutHost.hostId
      : null;
  const hostLabel = rolloutHost.hostName ?? rolloutHost.hostId ?? "";
  let rollout: CodexRollout;
  let localFiles: ReturnType<typeof findRolloutsInHomes> = null;
  if (remoteHostId !== null) {
    const read = await callRolloutHost(deps, remoteHostId, {
      type: "codex.rollouts.read",
      providerThreadId,
      home: "shared",
    });
    if (read.rollouts === null) {
      throw rolloutMissingError(providerThreadId, `on ${hostLabel}`);
    }
    rollout = mergeRollouts(read.rollouts.contents.map(parseRolloutText));
  } else {
    localFiles = findRolloutsInHomes(homes, providerThreadId, ["shared"]);
    if (localFiles === null) {
      throw rolloutMissingError(providerThreadId, `under ${homes.shared}`);
    }
    rollout = await parseRolloutFiles(localFiles.paths);
  }
  const syncedOrdinal = link.sourceSyncedOrdinal;
  const execution = importExecutionFor(rollout);
  const appended = deps.db.transaction(
    (tx) => {
      const newTurns = rollout.turns.filter(
        (turn) =>
          turn.lastOrdinal > syncedOrdinal &&
          !hasStoredTurnStarted(tx, {
            threadId: thread.id,
            turnId: turn.turnId,
          }),
      );
      const result = appendRolloutTurnsInTransaction(tx, {
        execution,
        providerThreadId,
        thread,
        turns: newTurns,
        withIdentity: false,
      });
      setThreadCodexLink(tx, {
        threadId: thread.id,
        sourceProviderThreadId: link.sourceProviderThreadId ?? providerThreadId,
        handoffState: null,
        sourceSyncedOrdinal: Math.max(rollout.lastOrdinal, syncedOrdinal),
      });
      return result;
    },
    { behavior: "immediate" },
  );
  let rolloutPath: string;
  if (remoteHostId !== null) {
    const copied = await callRolloutHost(deps, remoteHostId, {
      type: "codex.rollouts.copy",
      providerThreadId,
      from: "shared",
      to: "private",
    });
    rolloutPath = copied.copied?.paths[copied.copied.paths.length - 1] ?? "";
  } else if (localFiles !== null) {
    const copied = copyRolloutsToHome(localFiles, homes.private);
    rolloutPath = copied[copied.length - 1] ?? localFiles.paths[0] ?? "";
  } else {
    rolloutPath = "";
  }
  deps.hub.notifyThread(thread.id, ["events-appended", "title-changed"], {
    eventTypes: appended.eventTypes,
  });
  return {
    threadId: thread.id,
    providerThreadId,
    rolloutPath,
    appendedTurns: appended.appendedTurns,
    appendedEvents: appended.appendedEvents,
  };
}

export function codexSessionUserText(
  item: Extract<CodexRolloutItem, { type: "userMessage" }>,
): string {
  return userMessageText(item);
}
