import { randomUUID } from "node:crypto";
import { getThread, listEvents } from "@kaioken/db";
import { buildThreadEventRow, turnScope } from "@kaioken/domain";
import { expect, it } from "vitest";
import { z } from "zod";
import {
  handoffStartRequestSchema,
  type HandoffExport,
} from "@kaioken/server-contract";
import { HandoffCoordinator } from "../../src/services/connections/handoff-coordinator.js";
import {
  assertThreadHasNoConnectionHandoff,
  getHandoff,
  insertHandoff,
  updateHandoff,
} from "../../src/services/connections/handoff-store.js";
import type { ConnectionRequest } from "../../src/services/connections/connection-request.js";
import { withTestHarness } from "../helpers/test-app.js";
import {
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
} from "../helpers/seed.js";
import {
  reportQueuedCommandError,
  reportQueuedCommandSuccess,
  waitForQueuedCommand,
} from "../helpers/commands.js";
import {
  finalizeHandoff,
  receiveHandoff,
} from "../../src/services/connections/handoff-workspace.js";
import { getLastProviderThreadId } from "../../src/services/threads/thread-events.js";

const snapshot: HandoffExport = {
  providerId: "codex",
  manifest: {
    git: {
      remotes: ["example.test/org/repo"],
      subdirectory: "app",
      headSha: "a".repeat(40),
      indexSha: "b".repeat(40),
      workingSha: "c".repeat(40),
      bundleRef: `refs/kaioken/transfers/${randomUUID()}`,
      sha256: "d".repeat(64),
      sizeBytes: 3,
    },
    providerThreadId: randomUUID(),
    session: { sha256: "e".repeat(64), sizeBytes: 3 },
  },
  title: "Continuity",
  model: "gpt-5.5",
  reasoningLevel: null,
  serviceTier: null,
  permissionMode: "accept-edits",
  history: [],
  attachments: [],
};
function requestInput() {
  return {
    id: randomUUID(),
    source: { handle: null, serverId: randomUUID() },
    sourceThreadId: "source-task",
    destination: { handle: "ssh.workstation", serverId: randomUUID() },
    destinationProjectId: "destination-project",
  };
}
const finalizeSchema = z.object({ role: z.string(), action: z.string() });

it("imports the conversation, forks the transferred native session, and reveals the destination only after resume", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps);
    seedPrimaryHost(harness.deps, host.id);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const id = randomUUID();
    const providerThreadId = randomUUID();
    const history = [
      buildThreadEventRow({
        id: "source-message",
        threadId: "source-task",
        scope: turnScope("source-turn"),
        seq: 2,
        createdAt: Date.now(),
        event: {
          type: "item/completed",
          providerThreadId: snapshot.manifest.providerThreadId,
          threadId: "source-task",
          scope: turnScope("source-turn"),
          item: {
            type: "userMessage",
            id: "source-item",
            content: [{ type: "text", text: "Keep this conversation" }],
          },
        },
      }),
    ];
    const request = {
      id,
      projectId: project.id,
      snapshot: { ...snapshot, history },
      retryResume: false,
    };
    const receiving = receiveHandoff(harness.deps, request);
    const restore = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "workspace.transfer.restore",
    );
    if (restore.command.type !== "workspace.transfer.restore")
      throw new Error("Expected workspace restore");
    await reportQueuedCommandSuccess(harness, restore, {
      workspacePath: "/tmp/handoff-restored/app",
      providerThreadId: restore.command.targetProviderThreadId,
    });
    const result = await receiving;
    expect(result.ready).toBe(false);
    expect(getThread(harness.db, result.threadId)).toMatchObject({
      visibility: "hidden",
      sourceThreadId: null,
    });
    const copied = listEvents(harness.db, { threadId: result.threadId }).find(
      (event) => event.type === "item/completed",
    );
    expect(copied?.providerThreadId).toBeNull();
    expect(copied?.data).toContain("Keep this conversation");
    const start = await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "thread.start" && command.threadId === result.threadId,
    );
    if (start.command.type !== "thread.start")
      throw new Error("Expected native fork start");
    expect(start.command.input).toEqual([]);
    expect(start.command.fork).toEqual({
      sourceProviderThreadId: restore.command.targetProviderThreadId,
    });
    await expect(
      finalizeHandoff(harness.deps, id, "destination", "commit"),
    ).rejects.toThrow(/still resuming/);
    await reportQueuedCommandSuccess(harness, start, { providerThreadId });
    expect(await receiveHandoff(harness.deps, request)).toEqual({
      threadId: result.threadId,
      ready: true,
    });
    expect(getLastProviderThreadId(harness.deps, result.threadId)).toBe(
      providerThreadId,
    );
    await finalizeHandoff(harness.deps, id, "destination", "commit");
    expect(getThread(harness.db, result.threadId)?.visibility).toBe("visible");
    await expect(
      finalizeHandoff(harness.deps, id, "destination", "cancel"),
    ).rejects.toThrow(/already completed/);
  });
});

it("keeps source locked after a lost completion response and resumes the same operation after controller restart", async () => {
  await withTestHarness(async (harness) => {
    const input = requestInput();
    let loseSourceCommitResponse = true;
    const effects: string[] = [];
    const request: ConnectionRequest = async (
      _target,
      endpoint,
      body,
      schema,
    ) => {
      let value: unknown;
      if (endpoint === "/inspect") value = snapshot.manifest.git;
      else if (endpoint === "/match")
        value = [
          {
            id: "destination-project",
            name: "Project",
            hostId: "destination-host",
            path: "/repo/app",
          },
        ];
      else if (endpoint === "/export") {
        if (!getHandoff(harness.db, input.id, "source"))
          insertHandoff(harness.db, {
            id: input.id,
            role: "source",
            phase: "exported",
            sourceThreadId: input.sourceThreadId,
            targetThreadId: null,
            payload: "{}",
            error: null,
          });
        value = snapshot;
      } else if (endpoint === "/read")
        value = { data: "YWJj", nextOffset: 3, done: true };
      else if (endpoint === "/write") value = { nextOffset: 3 };
      else if (endpoint === "/receive")
        value = { threadId: "destination-task", ready: true };
      else if (endpoint === "/finalize") {
        const final = finalizeSchema.parse(body);
        effects.push(`${final.role}:${final.action}`);
        if (final.role === "source" && loseSourceCommitResponse)
          throw new Error(
            "Connection closed before the source acknowledged completion",
          );
        if (final.role === "source")
          updateHandoff(harness.db, input.id, "source", { phase: "complete" });
        value = { ok: true };
      } else throw new Error(`Unexpected ${endpoint}`);
      return schema.parse(value);
    };
    const first = new HandoffCoordinator(harness.deps, request);
    await first.start(input);
    await expect.poll(() => first.status(input.id).phase).toBe("failed");
    expect(effects).toEqual(["destination:commit", "source:commit"]);
    expect(() =>
      assertThreadHasNoConnectionHandoff(harness.db, input.sourceThreadId),
    ).toThrow(/moving/);
    loseSourceCommitResponse = false;
    const restarted = new HandoffCoordinator(harness.deps, request);
    await restarted.action(input.id, "retry");
    await expect.poll(() => restarted.status(input.id).phase).toBe("complete");
    expect(restarted.status(input.id)).toMatchObject({
      destinationThreadId: "destination-task",
      transferredBytes: 6,
      totalBytes: 6,
    });
    expect(() =>
      assertThreadHasNoConnectionHandoff(harness.db, input.sourceThreadId),
    ).not.toThrow();
    await expect(
      restarted.start({ ...input, sourceThreadId: "another-task" }),
    ).rejects.toThrow(/another request/);
  });
});

it("only releases the source after destination cancellation is confirmed", async () => {
  await withTestHarness(async (harness) => {
    const input = requestInput();
    insertHandoff(harness.db, {
      id: input.id,
      role: "controller",
      phase: "failed",
      sourceThreadId: input.sourceThreadId,
      targetThreadId: null,
      payload: JSON.stringify({
        request: handoffStartRequestSchema.parse(input),
        transferredBytes: 0,
        totalBytes: 6,
      }),
      error: "offline",
    });
    insertHandoff(harness.db, {
      id: input.id,
      role: "source",
      phase: "exported",
      sourceThreadId: input.sourceThreadId,
      targetThreadId: null,
      payload: "{}",
      error: null,
    });
    let offline = true;
    const effects: string[] = [];
    const request: ConnectionRequest = async (
      _target,
      endpoint,
      body,
      schema,
    ) => {
      expect(endpoint).toBe("/finalize");
      const final = finalizeSchema.parse(body);
      effects.push(final.role);
      if (final.role === "destination" && offline)
        throw new Error("Destination offline");
      if (final.role === "source")
        updateHandoff(harness.db, input.id, "source", { phase: "cancelled" });
      return schema.parse({ ok: true });
    };
    const coordinator = new HandoffCoordinator(harness.deps, request);
    await coordinator.action(input.id, "cancel");
    await expect.poll(() => coordinator.status(input.id).phase).toBe("failed");
    expect(effects).toEqual(["destination"]);
    expect(() =>
      assertThreadHasNoConnectionHandoff(harness.db, input.sourceThreadId),
    ).toThrow();
    offline = false;
    await coordinator.action(input.id, "cancel");
    await expect
      .poll(() => coordinator.status(input.id).phase)
      .toBe("cancelled");
    expect(effects).toEqual(["destination", "destination", "source"]);
    expect(() =>
      assertThreadHasNoConnectionHandoff(harness.db, input.sourceThreadId),
    ).not.toThrow();
  });
});

it("retries a failed native fork in the same restored workspace and cancels the hidden destination", async () => {
  await withTestHarness(async (harness) => {
    const { host } = seedHostSession(harness.deps);
    seedPrimaryHost(harness.deps, host.id);
    const { project } = seedProjectWithSource(harness.deps, {
      hostId: host.id,
    });
    const request = {
      id: randomUUID(),
      projectId: project.id,
      snapshot,
      retryResume: false,
    };
    const receiving = receiveHandoff(harness.deps, request);
    const restore = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "workspace.transfer.restore",
    );
    if (restore.command.type !== "workspace.transfer.restore")
      throw new Error("Expected workspace restore");
    const restored = {
      workspacePath: "/tmp/handoff-retry/app",
      providerThreadId: restore.command.targetProviderThreadId,
    };
    await reportQueuedCommandSuccess(harness, restore, restored);
    const first = await receiving;
    const start = await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "thread.start" && command.threadId === first.threadId,
    );
    await reportQueuedCommandError(harness, start, {
      errorCode: "native_fork_failed",
      errorMessage: "Codex failed to fork",
    });
    await expect(receiveHandoff(harness.deps, request)).rejects.toThrow(
      /could not resume/,
    );
    const retrying = receiveHandoff(harness.deps, {
      ...request,
      retryResume: true,
    });
    const retryRestore = await waitForQueuedCommand(
      harness,
      ({ command }) => command.type === "workspace.transfer.restore",
    );
    expect(retryRestore.command).toEqual(restore.command);
    await reportQueuedCommandSuccess(harness, retryRestore, restored);
    const second = await retrying;
    expect(second.threadId).not.toBe(first.threadId);
    expect(getThread(harness.db, first.threadId)?.deletedAt).not.toBeNull();
    const retryStart = await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "thread.start" && command.threadId === second.threadId,
    );
    await reportQueuedCommandSuccess(harness, retryStart, {
      providerThreadId: randomUUID(),
    });
    const cancelling = finalizeHandoff(
      harness.deps,
      request.id,
      "destination",
      "cancel",
    );
    const stop = await waitForQueuedCommand(
      harness,
      ({ command }) =>
        command.type === "thread.stop" && command.threadId === second.threadId,
    );
    await reportQueuedCommandSuccess(harness, stop, {
      providerCheckpointId: null,
    });
    await cancelling;
    expect(getThread(harness.db, second.threadId)).toMatchObject({
      visibility: "hidden",
      archivedAt: expect.any(Number),
    });
    await expect(receiveHandoff(harness.deps, request)).rejects.toThrow(
      /cancelled/,
    );
  });
});

it("cancels an active transfer before writing another chunk and confirms the destination first", async () => {
  await withTestHarness(async (harness) => {
    const input = requestInput();
    let finishRead = () => {};
    const pendingRead = new Promise<void>((resolve) => {
      finishRead = resolve;
    });
    let reading = false;
    const effects: string[] = [];
    const request: ConnectionRequest = async (
      _target,
      endpoint,
      body,
      schema,
    ) => {
      let value: unknown;
      if (endpoint === "/inspect") value = snapshot.manifest.git;
      else if (endpoint === "/match")
        value = [
          {
            id: input.destinationProjectId,
            name: "Project",
            hostId: "host",
            path: "/repo/app",
          },
        ];
      else if (endpoint === "/export") value = snapshot;
      else if (endpoint === "/read") {
        reading = true;
        await pendingRead;
        value = { data: "YWJj", nextOffset: 3, done: true };
      } else if (endpoint === "/finalize") {
        const final = finalizeSchema.parse(body);
        effects.push(`${final.role}:${final.action}`);
        value = { ok: true };
      } else throw new Error(`Unexpected ${endpoint}`);
      return schema.parse(value);
    };
    const coordinator = new HandoffCoordinator(harness.deps, request);
    await coordinator.start(input);
    await expect.poll(() => reading).toBe(true);
    expect((await coordinator.action(input.id, "cancel")).phase).toBe(
      "cancelling",
    );
    expect(effects).toEqual([]);
    finishRead();
    await expect
      .poll(() => coordinator.status(input.id).phase)
      .toBe("cancelled");
    expect(effects).toEqual(["destination:cancel", "source:cancel"]);
    expect(coordinator.status(input.id).transferredBytes).toBe(0);
  });
});
