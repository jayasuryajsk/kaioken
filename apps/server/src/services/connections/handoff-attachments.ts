import { createHash } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { jsonValueSchema, type JsonValue } from "@kaioken/domain";
import {
  handoffExportSchema,
  type HandoffExport,
} from "@kaioken/server-contract";
import { WORKSPACE_TRANSFER_CHUNK_BYTES } from "@kaioken/host-daemon-contract";
import type { AppDeps } from "../../types.js";
import {
  readAttachment,
  readAttachmentRange,
} from "../projects/attachments.js";
import { getHandoff, runHandoffOnce } from "./handoff-store.js";
import { z } from "zod";

function visit(
  value: JsonValue,
  transform: (value: { [key: string]: JsonValue }) => {
    [key: string]: JsonValue;
  },
): JsonValue {
  if (Array.isArray(value)) return value.map((item) => visit(item, transform));
  if (typeof value !== "object" || value === null) return value;
  return transform(
    Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, visit(item, transform)]),
    ),
  );
}
function isAttachment(value: {
  [key: string]: JsonValue;
}): value is { [key: string]: JsonValue; path: string } {
  return (
    (value.type === "localFile" || value.type === "localImage") &&
    typeof value.path === "string" &&
    !path.isAbsolute(value.path) &&
    !path.win32.isAbsolute(value.path) &&
    !/^[a-zA-Z][a-zA-Z0-9+.-]*:/u.test(value.path)
  );
}
export async function collectHandoffAttachments(
  deps: AppDeps,
  projectId: string,
  history: HandoffExport["history"],
): Promise<HandoffExport["attachments"]> {
  const paths = new Set<string>();
  visit(jsonValueSchema.parse(history), (value) => {
    if (isAttachment(value)) paths.add(value.path);
    return value;
  });
  const attachments: HandoffExport["attachments"] = [];
  for (const attachmentPath of paths) {
    const { content } = await readAttachment(
      deps.config.dataDir,
      projectId,
      attachmentPath,
    );
    attachments.push({
      path: attachmentPath,
      sha256: createHash("sha256").update(content).digest("hex"),
      sizeBytes: content.byteLength,
    });
  }
  return attachments;
}
const sourceAttachmentsSchema = z.object({
  projectId: z.string(),
  snapshot: handoffExportSchema,
});
export async function readHandoffAttachmentChunk(
  deps: AppDeps,
  id: string,
  file: string,
  offset: number,
) {
  const row = getHandoff(deps.db, id, "source");
  if (!row || row.phase === "cancelled")
    throw new Error("The source handoff is unavailable");
  const state = sourceAttachmentsSchema.parse(JSON.parse(row.payload));
  const attachment = state.snapshot.attachments.find(
    (item) => `attachment.${item.sha256}` === file,
  );
  if (!attachment) throw new Error("This file is not part of the handoff");
  const content = await readAttachmentRange(
    deps.config.dataDir,
    state.projectId,
    attachment.path,
    offset,
    WORKSPACE_TRANSFER_CHUNK_BYTES,
    attachment.sizeBytes,
  );
  const end = offset + content.byteLength;
  return {
    data: content.toString("base64"),
    nextOffset: end,
    done: end === attachment.sizeBytes,
  };
}
function incomingAttachmentPath(deps: AppDeps, id: string, file: string) {
  z.string().uuid().parse(id);
  z.string()
    .regex(/^attachment\.[a-f0-9]{64}$/u)
    .parse(file);
  return path.join(deps.config.dataDir, "connection-handoffs", id, file);
}
export async function writeHandoffAttachmentChunk(
  deps: AppDeps,
  id: string,
  file: string,
  offset: number,
  encoded: string,
) {
  const target = incomingAttachmentPath(deps, id, file);
  return runHandoffOnce(target, async () => {
    const data = Buffer.from(encoded, "base64");
    if (
      data.toString("base64") !== encoded ||
      data.byteLength > WORKSPACE_TRANSFER_CHUNK_BYTES
    )
      throw new Error("Invalid attachment transfer chunk");
    await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
    const handle = await open(target, "a+", 0o600);
    try {
      const size = (await handle.stat()).size;
      if (offset > size)
        throw new Error("Attachment chunks must arrive in order");
      if (offset < size) {
        const existing = Buffer.alloc(data.byteLength);
        const { bytesRead } = await handle.read(
          existing,
          0,
          existing.length,
          offset,
        );
        if (
          !existing.subarray(0, bytesRead).equals(data.subarray(0, bytesRead))
        )
          throw new Error("Conflicting attachment transfer chunk");
        if (bytesRead < data.byteLength) {
          await handle.writeFile(data.subarray(bytesRead));
          await handle.sync();
        }
      } else {
        await handle.writeFile(data);
        await handle.sync();
      }
      return { nextOffset: offset + data.byteLength };
    } finally {
      await handle.close();
    }
  });
}
export async function restoreHandoffAttachments(
  deps: AppDeps,
  id: string,
  projectId: string,
  snapshot: HandoffExport,
): Promise<HandoffExport> {
  const replacements = new Map<string, string>();
  const directory = path.join(deps.config.dataDir, "attachments", projectId);
  for (const attachment of snapshot.attachments) {
    const contents =
      attachment.sizeBytes === 0
        ? Buffer.alloc(0)
        : await readFile(
            incomingAttachmentPath(deps, id, `attachment.${attachment.sha256}`),
          );
    if (
      contents.byteLength !== attachment.sizeBytes ||
      createHash("sha256").update(contents).digest("hex") !== attachment.sha256
    )
      throw new Error("The transferred attachment is incomplete or damaged");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const file = `handoff-${id}-${attachment.sha256}${path.extname(attachment.path).replace(/[^.a-zA-Z0-9]/gu, "")}`;
    const output = path.join(directory, file);
    try {
      await writeFile(output, contents, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if (
        !(
          error instanceof Error &&
          "code" in error &&
          error.code === "EEXIST"
        ) ||
        !(await readFile(output)).equals(contents)
      )
        throw error;
    }
    replacements.set(attachment.path, file);
  }
  const history = visit(jsonValueSchema.parse(snapshot.history), (value) => {
    if (!isAttachment(value)) return value;
    const replacement = replacements.get(value.path);
    if (!replacement)
      throw new Error("A conversation attachment was omitted from the handoff");
    return { ...value, path: replacement };
  });
  return handoffExportSchema.parse({ ...snapshot, history });
}
