import { isDeepStrictEqual } from "node:util";
import { z } from "zod";
import {
  handoffExportSchema,
  handoffPreviewSchema,
  handoffProjectSchema,
  handoffReceiveResultSchema,
  handoffStartRequestSchema,
  handoffStatusSchema,
  type HandoffPreviewRequest,
  type HandoffStartRequest,
  type HandoffStatus,
} from "@kaioken/server-contract";
import {
  WORKSPACE_TRANSFER_CHUNK_BYTES,
  gitTransferRepositorySchema,
  workspaceTransferChunkSchema,
  workspaceTransferWriteResultSchema,
} from "@kaioken/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import { ApiError } from "../../errors.js";
import { getHandoff, insertHandoff, updateHandoff } from "./handoff-store.js";
import type { ConnectionRequest } from "./connection-request.js";

const payloadSchema = z.object({
  request: handoffStartRequestSchema,
  transferredBytes: z.number(),
  totalBytes: z.number(),
});
const okSchema = z.object({ ok: z.literal(true) });
export class HandoffCoordinator {
  private running = new Map<string, Promise<void>>();
  constructor(
    private deps: AppDeps,
    private request: ConnectionRequest,
  ) {}
  async preview(input: HandoffPreviewRequest) {
    if (input.source.serverId === input.destination.serverId)
      throw new ApiError(
        400,
        "handoff_same_computer",
        "Choose a different destination computer",
      );
    const repository = await this.request(
      input.source,
      "/inspect",
      { threadId: input.sourceThreadId },
      gitTransferRepositorySchema,
    );
    const projects = await this.request(
      input.destination,
      "/match",
      { repository },
      z.array(handoffProjectSchema),
    );
    return handoffPreviewSchema.parse({ repository, projects });
  }
  status(id: string): HandoffStatus {
    const row = getHandoff(this.deps.db, id, "controller");
    if (!row) throw new ApiError(404, "handoff_not_found", "Handoff not found");
    const payload = payloadSchema.parse(JSON.parse(row.payload));
    return handoffStatusSchema.parse({
      ...payload.request,
      destinationThreadId: row.targetThreadId,
      phase: row.phase,
      transferredBytes: payload.transferredBytes,
      totalBytes: payload.totalBytes,
      error: row.error,
      updatedAt: row.updatedAt,
    });
  }
  get(id: string) {
    const status = this.status(id);
    if (!["failed", "complete", "cancelled"].includes(status.phase))
      this.resume(id);
    return status;
  }
  async start(input: HandoffStartRequest) {
    const existing = getHandoff(this.deps.db, input.id, "controller");
    if (existing) {
      const payload = payloadSchema.parse(JSON.parse(existing.payload));
      if (!isDeepStrictEqual(payload.request, input))
        throw new ApiError(
          409,
          "handoff_conflict",
          "This handoff identity already belongs to another request",
        );
      return this.get(input.id);
    }
    const preview = await this.preview(input);
    if (
      !preview.projects.some(
        (project) => project.id === input.destinationProjectId,
      )
    )
      throw new ApiError(
        409,
        "handoff_project_mismatch",
        "Choose a saved destination project with the same Git repository and subdirectory",
      );
    insertHandoff(this.deps.db, {
      id: input.id,
      role: "controller",
      phase: "preparing",
      sourceThreadId: input.sourceThreadId,
      targetThreadId: null,
      error: null,
      payload: JSON.stringify({
        request: input,
        transferredBytes: 0,
        totalBytes: 0,
      }),
    });
    this.resume(input.id);
    return this.status(input.id);
  }
  private resume(id: string): void {
    if (this.running.has(id)) return;
    const cancelling = this.status(id).phase === "cancelling";
    const promise = (cancelling ? this.cancelRun(id) : this.run(id))
      .catch((error: unknown) => {
        if (!cancelling && this.status(id).phase === "cancelling") return;
        updateHandoff(this.deps.db, id, "controller", {
          phase: "failed",
          error:
            error instanceof Error
              ? error.message
              : "The handoff was interrupted",
        });
      })
      .finally(() => {
        this.running.delete(id);
        if (!cancelling && this.status(id).phase === "cancelling")
          this.resume(id);
      });
    this.running.set(id, promise);
  }
  private async run(id: string): Promise<void> {
    const status = this.status(id);
    if (["complete", "cancelled"].includes(status.phase)) return;
    const source = status.source;
    const destination = status.destination;
    const assertContinuing = () => {
      if (this.status(id).phase === "cancelling")
        throw new Error("Handoff cancellation requested");
    };
    const phase = (value: HandoffStatus["phase"]) => {
      assertContinuing();
      updateHandoff(this.deps.db, id, "controller", {
        phase: value,
        error: null,
      });
    };
    phase("pausing");
    const snapshot = await this.request(
      source,
      "/export",
      { id, threadId: status.sourceThreadId },
      handoffExportSchema,
    );
    const files = new Map<string, number>([
      ["git", snapshot.manifest.git.sizeBytes],
      ["session", snapshot.manifest.session.sizeBytes],
    ]);
    for (const attachment of snapshot.attachments) {
      const file = `attachment.${attachment.sha256}`;
      const previousSize = files.get(file);
      if (previousSize !== undefined && previousSize !== attachment.sizeBytes)
        throw new Error("The source returned conflicting attachment sizes");
      files.set(file, attachment.sizeBytes);
    }
    const totalBytes = [...files.values()].reduce((sum, size) => sum + size, 0);
    let transferredBytes = 0;
    const request: HandoffStartRequest = {
      id,
      source,
      sourceThreadId: status.sourceThreadId,
      destination,
      destinationProjectId: status.destinationProjectId,
    };
    const progress = () =>
      updateHandoff(this.deps.db, id, "controller", {
        payload: JSON.stringify({ request, transferredBytes, totalBytes }),
      });
    phase("transferring");
    progress();
    for (const [file, sizeBytes] of files) {
      let offset = 0;
      while (true) {
        assertContinuing();
        const chunk = await this.request(
          source,
          "/read",
          { id, file, offset },
          workspaceTransferChunkSchema,
        );
        assertContinuing();
        const bytes = Buffer.from(chunk.data, "base64");
        if (
          bytes.toString("base64") !== chunk.data ||
          bytes.length > WORKSPACE_TRANSFER_CHUNK_BYTES ||
          chunk.nextOffset !== offset + bytes.length ||
          chunk.nextOffset > sizeBytes ||
          chunk.done !== (chunk.nextOffset === sizeBytes) ||
          (bytes.length === 0 && !chunk.done)
        )
          throw new Error(
            "The source computer returned an invalid transfer chunk",
          );
        if (chunk.data.length > 0) {
          const accepted = await this.request(
            destination,
            "/write",
            {
              id,
              projectId: status.destinationProjectId,
              file,
              offset,
              data: chunk.data,
            },
            workspaceTransferWriteResultSchema,
          );
          if (accepted.nextOffset !== chunk.nextOffset)
            throw new Error(
              "The destination acknowledged a different transfer offset",
            );
          transferredBytes += chunk.nextOffset - offset;
          progress();
        }
        offset = chunk.nextOffset;
        if (chunk.done) break;
      }
    }
    phase("restoring");
    const receive = (retryResume = false) =>
      this.request(
        destination,
        "/receive",
        { id, projectId: status.destinationProjectId, snapshot, retryResume },
        handoffReceiveResultSchema,
      );
    let received = await receive(status.phase === "failed");
    updateHandoff(this.deps.db, id, "controller", {
      targetThreadId: received.threadId,
    });
    phase("resuming");
    const deadline = Date.now() + 120_000;
    while (!received.ready) {
      assertContinuing();
      if (Date.now() >= deadline)
        throw new Error(
          "Codex is still resuming on the destination. Retry to check its progress.",
        );
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      received = await receive();
    }
    phase("completing");
    await this.request(
      destination,
      "/finalize",
      { id, role: "destination", action: "commit" },
      okSchema,
    );
    await this.request(
      source,
      "/finalize",
      { id, role: "source", action: "commit" },
      okSchema,
    );
    phase("complete");
  }
  private async cancelRun(id: string): Promise<void> {
    const status = this.status(id);
    await this.request(
      status.destination,
      "/finalize",
      { id, role: "destination", action: "cancel" },
      okSchema,
    );
    await this.request(
      status.source,
      "/finalize",
      { id, role: "source", action: "cancel" },
      okSchema,
    );
    updateHandoff(this.deps.db, id, "controller", {
      phase: "cancelled",
      error: null,
    });
  }
  async action(id: string, action: "retry" | "cancel") {
    const status = this.status(id);
    if (action === "retry") {
      if (this.running.has(id))
        throw new ApiError(
          409,
          "handoff_running",
          "The handoff is still running",
        );
      if (status.phase === "cancelled")
        throw new ApiError(
          409,
          "handoff_cancelled",
          "Start a new handoff after cancelling",
        );
      this.resume(id);
    } else {
      if (status.phase === "complete")
        throw new ApiError(
          409,
          "handoff_already_completed",
          "This task has already moved",
        );
      updateHandoff(this.deps.db, id, "controller", {
        phase: "cancelling",
        error: null,
      });
      this.resume(id);
    }
    return this.status(id);
  }
}
