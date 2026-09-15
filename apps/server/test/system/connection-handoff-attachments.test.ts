import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { buildThreadEventRow, turnScope } from "@kaioken/domain";
import type { HandoffExport } from "@kaioken/server-contract";
import {
  collectHandoffAttachments,
  readHandoffAttachmentChunk,
  restoreHandoffAttachments,
  writeHandoffAttachmentChunk,
} from "../../src/services/connections/handoff-attachments.js";
import { insertHandoff } from "../../src/services/connections/handoff-store.js";
import { withTestHarness } from "../helpers/test-app.js";

it("copies binary conversation attachments and rewrites references without overwriting destination files", async () => {
  await withTestHarness(async (harness) => {
    const projectId = "source-project",
      destinationProjectId = "destination-project",
      id = randomUUID();
    const data = Buffer.concat([
      Buffer.alloc(2 * 1024 * 1024, 128),
      Buffer.from([0, 255, 128, 123, 65]),
    ]);
    const sourceDirectory = path.join(
      harness.config.dataDir,
      "attachments",
      projectId,
    );
    await mkdir(sourceDirectory, { recursive: true });
    await writeFile(path.join(sourceDirectory, "attached.bin"), data);
    const history = [
      buildThreadEventRow({
        id: "event",
        threadId: "source-thread",
        seq: 2,
        createdAt: Date.now(),
        scope: turnScope("turn"),
        event: {
          type: "item/completed",
          providerThreadId: randomUUID(),
          threadId: "source-thread",
          scope: turnScope("turn"),
          item: {
            type: "userMessage",
            id: "message",
            content: [{ type: "localFile", path: "attached.bin" }],
          },
        },
      }),
    ];
    const attachments = await collectHandoffAttachments(
      harness.deps,
      projectId,
      history,
    );
    const snapshot: HandoffExport = {
      providerId: "codex",
      history,
      attachments,
      title: "Attachment continuity",
      model: "gpt-5.5",
      reasoningLevel: null,
      serviceTier: null,
      permissionMode: "accept-edits",
      manifest: {
        providerThreadId: randomUUID(),
        session: { sha256: "a".repeat(64), sizeBytes: 1 },
        git: {
          headSha: "a".repeat(40),
          indexSha: "b".repeat(40),
          workingSha: "c".repeat(40),
          bundleRef: `refs/kaioken/transfers/${randomUUID()}`,
          remotes: ["example.test/org/repo"],
          subdirectory: "",
          sha256: "d".repeat(64),
          sizeBytes: 1,
        },
      },
    };
    insertHandoff(harness.db, {
      id,
      role: "source",
      phase: "exported",
      sourceThreadId: "source-thread",
      targetThreadId: null,
      payload: JSON.stringify({ projectId, snapshot }),
      error: null,
    });
    const file = `attachment.${attachments[0]!.sha256}`;
    const chunk = await readHandoffAttachmentChunk(harness.deps, id, file, 0);
    expect(Buffer.from(chunk.data, "base64")).toEqual(
      data.subarray(0, chunk.nextOffset),
    );
    expect(chunk.nextOffset).toBe(1024 * 1024);
    expect(chunk.done).toBe(false);
    await writeHandoffAttachmentChunk(harness.deps, id, file, 0, chunk.data);
    let offset = chunk.nextOffset;
    while (offset < data.length) {
      const next = await readHandoffAttachmentChunk(
        harness.deps,
        id,
        file,
        offset,
      );
      expect(Buffer.from(next.data, "base64")).toEqual(
        data.subarray(offset, next.nextOffset),
      );
      await writeHandoffAttachmentChunk(
        harness.deps,
        id,
        file,
        offset,
        next.data,
      );
      offset = next.nextOffset;
      expect(next.done).toBe(offset === data.length);
    }
    await writeHandoffAttachmentChunk(harness.deps, id, file, 0, chunk.data);
    const destinationDirectory = path.join(
      harness.config.dataDir,
      "attachments",
      destinationProjectId,
    );
    await mkdir(destinationDirectory, { recursive: true });
    await writeFile(
      path.join(destinationDirectory, "attached.bin"),
      "Existing attachment",
    );
    const restored = await restoreHandoffAttachments(
      harness.deps,
      id,
      destinationProjectId,
      snapshot,
    );
    const target = restored.history[0];
    if (
      target?.type !== "item/completed" ||
      target.data.item.type !== "userMessage"
    )
      throw new Error("Missing user message");
    const content = target.data.item.content[0];
    if (content?.type !== "localFile") throw new Error("Missing attachment");
    expect(content.path).not.toBe("attached.bin");
    expect(
      await readFile(path.join(destinationDirectory, content.path)),
    ).toEqual(data);
    expect(
      await readFile(path.join(destinationDirectory, "attached.bin"), "utf8"),
    ).toBe("Existing attachment");
    expect(
      await restoreHandoffAttachments(
        harness.deps,
        id,
        destinationProjectId,
        snapshot,
      ),
    ).toEqual(restored);
    await writeFile(
      path.join(sourceDirectory, "attached.bin"),
      "Changed source",
    );
    await expect(
      readHandoffAttachmentChunk(harness.deps, id, file, 0),
    ).rejects.toThrow(/changed/);
    await expect(
      writeHandoffAttachmentChunk(
        harness.deps,
        id,
        "attachment../escape",
        0,
        chunk.data,
      ),
    ).rejects.toThrow();
  });
});
