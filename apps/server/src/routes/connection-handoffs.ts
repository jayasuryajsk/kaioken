import type { Hono } from "hono";
import {
  connectionSelfSchema,
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
} from "@kaioken/server-contract";
import type { AppDeps } from "../types.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { callHostOnlineRpc } from "../services/hosts/online-rpc.js";
import { createConnectionRequest } from "../services/connections/connection-request.js";
import { HandoffCoordinator } from "../services/connections/handoff-coordinator.js";
import {
  readHandoffAttachmentChunk,
  writeHandoffAttachmentChunk,
} from "../services/connections/handoff-attachments.js";
import {
  exportHandoff,
  finalizeHandoff,
  handoffDestinationProject,
  handoffSourceHost,
  inspectHandoffThread,
  matchHandoffProjects,
  receiveHandoff,
} from "../services/connections/handoff-workspace.js";

export function registerConnectionHandoffRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
): void {
  const { get, post } = typedRoutes<PublicApiSchema>(app);
  const routes = publicApiRoutes.connections;
  const request = createConnectionRequest(app, deps, plugins);
  const coordinator = new HandoffCoordinator(deps, request);
  post(routes.resolve, async (context, input) =>
    context.json(
      await request(
        { handle: input.handle, serverId: null },
        "/self",
        {},
        connectionSelfSchema,
      ),
    ),
  );
  post(routes.handoffPreview, async (context, input) =>
    context.json(await coordinator.preview(input)),
  );
  post(routes.handoffStart, async (context, input) =>
    context.json(await coordinator.start(input)),
  );
  get(routes.handoffGet, (context) =>
    context.json(coordinator.get(context.req.param("id"))),
  );
  post(routes.handoffAction, async (context, input) =>
    context.json(await coordinator.action(input.id, input.action)),
  );
  post(routes.handoffInspect, async (context, input) =>
    context.json(await inspectHandoffThread(deps, input.threadId)),
  );
  post(routes.handoffMatch, async (context, input) =>
    context.json(await matchHandoffProjects(deps, input.repository)),
  );
  post(routes.handoffExport, async (context, input) =>
    context.json(await exportHandoff(deps, input.id, input.threadId)),
  );
  post(routes.handoffReceive, async (context, input) =>
    context.json(await receiveHandoff(deps, input)),
  );
  post(routes.handoffRead, async (context, input) => {
    if (input.file !== "git" && input.file !== "session")
      return context.json(
        await readHandoffAttachmentChunk(
          deps,
          input.id,
          input.file,
          input.offset,
        ),
      );
    return context.json(
      await callHostOnlineRpc(deps, {
        hostId: handoffSourceHost(deps, input.id),
        timeoutMs: 30_000,
        command: {
          type: "workspace.transfer.read",
          operationId: input.id,
          file: input.file,
          offset: input.offset,
        },
      }),
    );
  });
  post(routes.handoffWrite, async (context, input) => {
    const destination = handoffDestinationProject(deps, input.projectId);
    if (input.file !== "git" && input.file !== "session")
      return context.json(
        await writeHandoffAttachmentChunk(
          deps,
          input.id,
          input.file,
          input.offset,
          input.data,
        ),
      );
    return context.json(
      await callHostOnlineRpc(deps, {
        hostId: destination.hostId,
        timeoutMs: 30_000,
        command: {
          type: "workspace.transfer.write",
          operationId: input.id,
          file: input.file,
          offset: input.offset,
          data: input.data,
        },
      }),
    );
  });
  post(routes.handoffFinalize, async (context, input) => {
    await finalizeHandoff(deps, input.id, input.role, input.action);
    return context.json({ ok: true });
  });
}
