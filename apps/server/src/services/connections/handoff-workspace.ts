import {
  requireCodexThread,
  requireCodexProviderId,
} from "../codex-sessions/codex-sessions.js";
import { isDeepStrictEqual } from "node:util";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq, isNull } from "drizzle-orm";
import {
  archiveThread,
  copyStoredThreadEventsInTransaction,
  createEnvironment,
  deleteThread,
  deriveStoredEventItemFields,
  findProjectEnvironmentByHostPath,
  getEnvironment,
  getPluginSettingsValues,
  getProjectSourceByHost,
  getThread,
  projects,
  projectSources,
  updateThread,
  type StoredEventRow,
} from "@kaioken/db";
import { buildThreadEvent } from "@kaioken/domain";
import {
  handoffExportSchema,
  handoffReceiveRequestSchema,
  type HandoffExport,
} from "@kaioken/server-contract";
import { gitTransferRepositorySchema } from "@kaioken/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import {
  getLastExecutionOptions,
  getLastProviderThreadId,
} from "../threads/thread-events.js";
import { stopThreadForCurrentState } from "../threads/thread-lifecycle.js";
import {
  INHERITED_EVENT_TYPES,
  selectInheritedForkEventRows,
} from "../threads/thread-fork-history.js";
import { listThreadEventRows } from "../threads/thread-data.js";
import { resolveExistingThreadPermissionMode } from "../threads/thread-execution-plan.js";
import { createThreadFromRequest } from "../threads/thread-create.js";
import {
  assertThreadHasNoConnectionHandoff,
  getHandoff,
  insertHandoff,
  runHandoffOnce,
  updateHandoff,
} from "./handoff-store.js";
import {
  collectHandoffAttachments,
  restoreHandoffAttachments,
} from "./handoff-attachments.js";

const sourceStateSchema = z.object({
  hostId: z.string(),
  path: z.string(),
  projectId: z.string(),
  snapshot: handoffExportSchema.nullable(),
});
const destinationStateSchema = handoffReceiveRequestSchema.extend({
  hostId: z.string(),
  path: z.string(),
  providerThreadId: z.string().uuid(),
  sessionHome: z.enum(["private", "shared"]),
});
export function requireHandoffThread(deps: AppDeps, threadId: string) {
  const thread = requireCodexThread(deps, threadId);
  const environment =
    thread.environmentId === null
      ? null
      : getEnvironment(deps.db, thread.environmentId);
  if (
    !environment ||
    environment.status !== "ready" ||
    environment.path === null
  )
    throw new ApiError(
      409,
      "handoff_workspace_unavailable",
      "The task needs a ready Git workspace before it can move",
    );
  return { thread, environment, workspacePath: environment.path };
}
export async function inspectHandoffThread(deps: AppDeps, threadId: string) {
  const { environment, workspacePath, thread } = requireHandoffThread(
    deps,
    threadId,
  );
  if (thread.archivedAt !== null)
    throw new ApiError(
      409,
      "handoff_source_archived",
      "Restore the archived task before moving it",
    );
  return callHostOnlineRpc(deps, {
    hostId: environment.hostId,
    timeoutMs: 30_000,
    command: { type: "workspace.transfer.inspect", path: workspacePath },
  });
}
export async function matchHandoffProjects(
  deps: AppDeps,
  repository: z.infer<typeof gitTransferRepositorySchema>,
) {
  const hostId = requireConnectedPrimaryHostId(deps);
  const sources = deps.db
    .select({ id: projects.id, name: projects.name, path: projectSources.path })
    .from(projects)
    .innerJoin(projectSources, eq(projectSources.projectId, projects.id))
    .where(
      and(
        eq(projectSources.hostId, hostId),
        eq(projectSources.type, "local_path"),
        eq(projects.kind, "standard"),
        isNull(projects.deletedAt),
      ),
    )
    .all();
  const matches: { id: string; name: string; hostId: string; path: string }[] =
    [];
  for (const source of sources) {
    if (source.path === null) continue;
    let found;
    try {
      found = await callHostOnlineRpc(deps, {
        hostId,
        timeoutMs: 15_000,
        command: { type: "workspace.transfer.inspect", path: source.path },
      });
    } catch {
      continue;
    }
    if (
      found.subdirectory === repository.subdirectory &&
      found.remotes.some((remote) => repository.remotes.includes(remote))
    )
      matches.push({
        id: source.id,
        name: source.name,
        hostId,
        path: source.path,
      });
  }
  return matches;
}
export async function exportHandoff(
  deps: AppDeps,
  id: string,
  threadId: string,
): Promise<HandoffExport> {
  return runHandoffOnce(`${deps.config.dataDir}:source:${id}`, async () => {
    let row = getHandoff(deps.db, id, "source");
    if (row && row.sourceThreadId !== threadId)
      throw new ApiError(
        409,
        "handoff_conflict",
        "This handoff belongs to another task",
      );
    if (row?.phase === "cancelled")
      throw new ApiError(
        409,
        "handoff_cancelled",
        "This handoff was cancelled",
      );
    if (row) {
      const saved = sourceStateSchema.parse(JSON.parse(row.payload));
      if (saved.snapshot) return saved.snapshot;
    }
    const { thread, environment, workspacePath } = requireHandoffThread(
      deps,
      threadId,
    );
    if (thread.archivedAt !== null)
      throw new ApiError(
        409,
        "handoff_source_archived",
        "Restore the archived task before moving it",
      );
    if (!row) {
      deps.db.transaction(
        (tx) => {
          assertThreadHasNoConnectionHandoff(tx, threadId);
          insertHandoff(tx, {
            id,
            role: "source",
            phase: "pausing",
            sourceThreadId: threadId,
            targetThreadId: null,
            payload: JSON.stringify({
              hostId: environment.hostId,
              path: workspacePath,
              projectId: thread.projectId,
              snapshot: null,
            }),
            error: null,
          });
        },
        { behavior: "immediate" },
      );
      row = getHandoff(deps.db, id, "source");
    }
    await stopThreadForCurrentState(deps, thread, environment);
    const settled = getThread(deps.db, threadId);
    if (!settled || !["idle", "error"].includes(settled.status))
      throw new ApiError(
        409,
        "handoff_source_busy",
        "The task is still stopping. Retry once its current turn has settled.",
      );
    const providerThreadId = getLastProviderThreadId(deps, threadId);
    const execution = getLastExecutionOptions(deps, threadId);
    if (providerThreadId === null || !execution?.model)
      throw new ApiError(
        409,
        "handoff_session_unavailable",
        "This task has no native Codex session to move",
      );
    const sourceRows = listThreadEventRows(deps.db, {
      threadId,
      types: INHERITED_EVENT_TYPES,
      order: "asc",
    });
    const lastSequence = sourceRows.at(-1)?.seq ?? 0;
    const inherited = new Set(
      selectInheritedForkEventRows(deps, {
        sourceThreadId: threadId,
        historyEndSequence: lastSequence,
      }).map((event) => event.sequence),
    );
    const history = sourceRows.filter((event) => inherited.has(event.seq));
    const attachments = await collectHandoffAttachments(
      deps,
      thread.projectId,
      history,
    );
    const manifest = await callHostOnlineRpc(deps, {
      hostId: environment.hostId,
      timeoutMs: 120_000,
      command: {
        type: "workspace.transfer.export",
        operationId: id,
        path: workspacePath,
        providerThreadId,
      },
    });
    const snapshot = handoffExportSchema.parse({
      providerId: thread.providerId,
      manifest,
      history,
      attachments,
      title: thread.title ?? thread.titleFallback ?? "Transferred task",
      model: execution.model,
      reasoningLevel: execution.reasoningLevel ?? null,
      serviceTier: execution.serviceTier ?? null,
      permissionMode: resolveExistingThreadPermissionMode(deps, threadId),
    });
    updateHandoff(deps.db, id, "source", {
      phase: "exported",
      payload: JSON.stringify({
        hostId: environment.hostId,
        path: workspacePath,
        projectId: thread.projectId,
        snapshot,
      }),
      error: null,
    });
    return snapshot;
  });
}
export function handoffSourceHost(deps: AppDeps, id: string): string {
  const row = getHandoff(deps.db, id, "source");
  if (!row || row.phase === "cancelled")
    throw new ApiError(404, "handoff_not_found", "Handoff not found");
  return sourceStateSchema.parse(JSON.parse(row.payload)).hostId;
}
export function handoffDestinationProject(deps: AppDeps, projectId: string) {
  const hostId = requireConnectedPrimaryHostId(deps);
  const source = getProjectSourceByHost(deps.db, projectId, hostId);
  const project = deps.db
    .select({ id: projects.id })
    .from(projects)
    .where(
      and(
        eq(projects.id, projectId),
        eq(projects.kind, "standard"),
        isNull(projects.deletedAt),
      ),
    )
    .get();
  if (!project || !source || source.type !== "local_path")
    throw new ApiError(
      404,
      "handoff_project_unavailable",
      "The destination project must have a checkout on this computer",
    );
  return { hostId, path: source.path };
}
function importedRows(snapshot: HandoffExport, id: string): StoredEventRow[] {
  return snapshot.history.map((row) => {
    const event = buildThreadEvent(row);
    if (!new Set<string>(INHERITED_EVENT_TYPES).has(event.type))
      throw new ApiError(
        400,
        "invalid_handoff_history",
        "The transfer contains unsupported history events",
      );
    return {
      id: `${id}:${row.id}`,
      threadId: row.threadId,
      sequence: row.seq,
      createdAt: row.createdAt,
      scopeKind: row.scope.kind,
      turnId: row.scope.kind === "turn" ? row.scope.turnId : null,
      type: row.type,
      providerThreadId: null,
      data: JSON.stringify(row.data),
      ...deriveStoredEventItemFields(event),
    };
  });
}
export async function receiveHandoff(
  deps: AppDeps,
  request: z.infer<typeof handoffReceiveRequestSchema>,
) {
  return runHandoffOnce(
    `${deps.config.dataDir}:destination:${request.id}`,
    async () => {
      let row = getHandoff(deps.db, request.id, "destination");
      if (row?.phase === "cancelled")
        throw new ApiError(
          409,
          "handoff_cancelled",
          "This handoff was cancelled",
        );
      const destination = handoffDestinationProject(deps, request.projectId);
      let state;
      if (row) {
        state = destinationStateSchema.parse(JSON.parse(row.payload));
        if (
          state.projectId !== request.projectId ||
          !isDeepStrictEqual(state.snapshot, request.snapshot)
        )
          throw new ApiError(
            409,
            "handoff_conflict",
            "This handoff already contains another task",
          );
      } else {
        const providerId = requireCodexProviderId(request.snapshot.providerId);
        const provider = deps.providerRegistry.get(providerId);
        if (!provider)
          throw new ApiError(
            409,
            "handoff_provider_unavailable",
            "Enable Codex on the destination computer before moving this task",
          );
        const settings = getPluginSettingsValues(deps.db, provider.pluginId);
        const privateHome = z
          .boolean()
          .parse(JSON.parse(settings.isolateCodexHome ?? "true"));
        state = {
          ...request,
          ...destination,
          providerThreadId: randomUUID(),
          sessionHome: privateHome ? ("private" as const) : ("shared" as const),
        };
        insertHandoff(deps.db, {
          id: request.id,
          role: "destination",
          phase: "restoring",
          sourceThreadId: null,
          targetThreadId: null,
          payload: JSON.stringify(state),
          error: null,
        });
      }
      if (
        row?.targetThreadId &&
        row.phase !== "complete" &&
        request.retryResume
      ) {
        let previous = getThread(deps.db, row.targetThreadId);
        if (previous?.visibility === "hidden" && row.phase === "creating") {
          await stopThreadForCurrentState(
            deps,
            previous,
            previous.environmentId === null
              ? null
              : getEnvironment(deps.db, previous.environmentId),
          );
          previous = getThread(deps.db, previous.id);
        }
        if (
          previous === null ||
          (previous.visibility === "hidden" &&
            (previous.status === "error" ||
              (row.phase === "creating" && previous.status === "idle")))
        ) {
          if (previous) deleteThread(deps.db, deps.hub, previous.id);
          updateHandoff(deps.db, request.id, "destination", {
            targetThreadId: null,
            phase: "restoring",
            error: null,
          });
          row = getHandoff(deps.db, request.id, "destination");
        }
      }
      if (!row?.targetThreadId) {
        const importedSnapshot = await restoreHandoffAttachments(
          deps,
          request.id,
          request.projectId,
          request.snapshot,
        );
        const restored = await callHostOnlineRpc(deps, {
          hostId: state.hostId,
          timeoutMs: 120_000,
          command: {
            type: "workspace.transfer.restore",
            operationId: request.id,
            projectPath: state.path,
            manifest: request.snapshot.manifest,
            targetProviderThreadId: state.providerThreadId,
            sessionHome: state.sessionHome,
          },
        });
        const environment =
          findProjectEnvironmentByHostPath(
            deps.db,
            request.projectId,
            state.hostId,
            restored.workspacePath,
          ) ??
          createEnvironment(deps.db, deps.hub, {
            projectId: request.projectId,
            hostId: state.hostId,
            path: restored.workspacePath,
            isGitRepo: true,
            status: "ready",
            branchName: `codex/handoff-${request.id}`,
            providerOwnsPath: false,
          });
        await createThreadFromRequest(
          deps,
          {
            projectId: request.projectId,
            environment: { type: "reuse", environmentId: environment.id },
            providerId: requireCodexProviderId(request.snapshot.providerId),
            model: request.snapshot.model,
            permissionMode: request.snapshot.permissionMode,
            ...(request.snapshot.reasoningLevel === null
              ? {}
              : { reasoningLevel: request.snapshot.reasoningLevel }),
            ...(request.snapshot.serviceTier === null
              ? {}
              : { serviceTier: request.snapshot.serviceTier }),
            title: request.snapshot.title,
            visibility: "hidden",
            input: [],
            origin: null,
            startedOnBehalfOf: null,
          },
          {
            importedFork: { sourceProviderThreadId: restored.providerThreadId },
            seedWithoutRun: true,
            onCreated: (thread) => {
              deps.db.transaction(
                (tx) => {
                  copyStoredThreadEventsInTransaction(tx, {
                    rows: importedRows(importedSnapshot, request.id),
                    targetThreadId: thread.id,
                    targetEnvironmentId: environment.id,
                  });
                  updateHandoff(tx, request.id, "destination", {
                    targetThreadId: thread.id,
                    phase: "creating",
                  });
                },
                { behavior: "immediate" },
              );
            },
          },
        );
        updateHandoff(deps.db, request.id, "destination", {
          phase: "resuming",
        });
        row = getHandoff(deps.db, request.id, "destination");
      }
      if (!row?.targetThreadId)
        throw new Error("The destination task was not recorded");
      if (row.phase === "complete")
        return { threadId: row.targetThreadId, ready: true };
      const thread = getThread(deps.db, row.targetThreadId);
      if (!thread || thread.deletedAt !== null || thread.status === "error")
        throw new ApiError(
          409,
          "handoff_resume_failed",
          "Codex could not resume the destination task. The source task is preserved.",
        );
      return {
        threadId: thread.id,
        ready:
          thread.status === "idle" &&
          getLastProviderThreadId(deps, thread.id) !== null,
      };
    },
  );
}
export async function finalizeHandoff(
  deps: AppDeps,
  id: string,
  role: "source" | "destination",
  action: "commit" | "cancel",
) {
  return runHandoffOnce(`${deps.config.dataDir}:${role}:${id}`, async () => {
    const row = getHandoff(deps.db, id, role);
    if (!row) {
      if (action === "cancel") {
        insertHandoff(deps.db, {
          id,
          role,
          phase: "cancelled",
          sourceThreadId: null,
          targetThreadId: null,
          payload: "{}",
          error: null,
        });
        return;
      }
      throw new ApiError(404, "handoff_not_found", "Handoff not found");
    }
    if (row.phase === "complete") {
      if (action === "cancel")
        throw new ApiError(
          409,
          "handoff_already_completed",
          "This handoff has already completed. Open the destination task.",
        );
      return;
    }
    if (row.phase === "cancelled") {
      if (action === "commit")
        throw new ApiError(
          409,
          "handoff_cancelled",
          "This handoff was cancelled",
        );
      return;
    }
    const threadId =
      role === "source" ? row.sourceThreadId : row.targetThreadId;
    if (action === "commit") {
      if (!threadId)
        throw new ApiError(
          409,
          "handoff_not_ready",
          "The destination task is not ready",
        );
      if (role === "destination") {
        const thread = getThread(deps.db, threadId);
        if (
          !thread ||
          thread.status !== "idle" ||
          getLastProviderThreadId(deps, threadId) === null
        )
          throw new ApiError(
            409,
            "handoff_not_ready",
            "Codex is still resuming the destination task",
          );
        updateThread(deps.db, deps.hub, threadId, { visibility: "visible" });
      } else {
        archiveThread(deps.db, deps.hub, threadId);
      }
    } else if (role === "destination" && threadId) {
      const thread = getThread(deps.db, threadId);
      if (thread) {
        await stopThreadForCurrentState(
          deps,
          thread,
          thread.environmentId === null
            ? null
            : getEnvironment(deps.db, thread.environmentId),
        );
        archiveThread(deps.db, deps.hub, threadId);
      }
    }
    updateHandoff(deps.db, id, role, {
      phase: action === "commit" ? "complete" : "cancelled",
      error: null,
    });
  });
}
