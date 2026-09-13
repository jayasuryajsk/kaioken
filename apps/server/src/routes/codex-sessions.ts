import {
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@kaioken/server-contract";
import type { Hono } from "hono";
import { ApiError } from "../errors.js";
import {
  getCodexThreadLink,
  handoffCodexSession,
  importCodexSession,
  listCodexSessions,
  syncCodexSession,
} from "../services/codex-sessions/codex-sessions.js";
import { toThreadResponseFromThread } from "../services/threads/thread-runtime-display.js";
import type { AppDeps } from "../types.js";

export function registerCodexSessionRoutes(app: Hono, deps: AppDeps): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app, {
    onValidationError: (message) =>
      new ApiError(400, "invalid_request", message),
  });
  const routes = publicApiRoutes.codex;

  get(routes.listSessions, (context, query) =>
    context.json(
      listCodexSessions(deps, {
        includeArchived: query.includeArchived === "true",
      }),
    ),
  );

  post(routes.importSession, async (context, payload) => {
    const outcome = await importCodexSession(deps, {
      id: payload.id,
      ...(payload.projectId !== undefined
        ? { projectId: payload.projectId }
        : {}),
      origin: payload.origin,
    });
    return context.json(
      toThreadResponseFromThread(deps, { thread: outcome.thread }),
      201,
    );
  });

  get(routes.threadLink, (context) =>
    context.json(getCodexThreadLink(deps, context.req.param("id"))),
  );

  post(routes.handoff, async (context) =>
    context.json(
      await handoffCodexSession(deps, { threadId: context.req.param("id") }),
    ),
  );

  post(routes.sync, async (context) =>
    context.json(
      await syncCodexSession(deps, { threadId: context.req.param("id") }),
    ),
  );
}
