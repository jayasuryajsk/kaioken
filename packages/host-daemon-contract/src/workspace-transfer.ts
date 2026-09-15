import { z } from "zod";

const sha = z.string().regex(/^[a-f0-9]{40,64}$/u);
const digest = z.string().regex(/^[a-f0-9]{64}$/u);
export const gitTransferRepositorySchema = z.object({
  remotes: z.array(z.string().min(1)).min(1),
  subdirectory: z
    .string()
    .refine(
      (value) =>
        !value.startsWith("/") && !value.split(/[\\/]/u).includes(".."),
    ),
});
export const gitTransferSnapshotSchema = gitTransferRepositorySchema.extend({
  headSha: sha,
  indexSha: sha,
  workingSha: sha,
  bundleRef: z.string().regex(/^refs\/kaioken\/transfers\/[a-f0-9-]+$/u),
  sha256: digest,
  sizeBytes: z.number().int().positive(),
});
export const workspaceTransferManifestSchema = z.object({
  git: gitTransferSnapshotSchema,
  providerThreadId: z.string().uuid(),
  session: z.object({ sha256: digest, sizeBytes: z.number().int().positive() }),
});
export type WorkspaceTransferManifest = z.infer<
  typeof workspaceTransferManifestSchema
>;
export const workspaceTransferFileSchema = z.enum(["git", "session"]);
export const WORKSPACE_TRANSFER_CHUNK_BYTES = 1024 * 1024;
const operation = z.object({ operationId: z.string().uuid() });
export const workspaceTransferCommandSchemas = {
  "workspace.transfer.inspect": z
    .object({
      type: z.literal("workspace.transfer.inspect"),
      path: z.string().min(1),
    })
    .strict(),
  "workspace.transfer.export": operation
    .extend({
      type: z.literal("workspace.transfer.export"),
      path: z.string().min(1),
      providerThreadId: z.string().uuid(),
    })
    .strict(),
  "workspace.transfer.read": operation
    .extend({
      type: z.literal("workspace.transfer.read"),
      file: workspaceTransferFileSchema,
      offset: z.number().int().nonnegative(),
    })
    .strict(),
  "workspace.transfer.write": operation
    .extend({
      type: z.literal("workspace.transfer.write"),
      file: workspaceTransferFileSchema,
      offset: z.number().int().nonnegative(),
      data: z.string().max(Math.ceil(WORKSPACE_TRANSFER_CHUNK_BYTES / 3) * 4),
    })
    .strict(),
  "workspace.transfer.restore": operation
    .extend({
      type: z.literal("workspace.transfer.restore"),
      projectPath: z.string().min(1),
      manifest: workspaceTransferManifestSchema,
      targetProviderThreadId: z.string().uuid(),
      sessionHome: z.enum(["private", "shared"]),
    })
    .strict(),
};
export const workspaceTransferChunkSchema = z.object({
  data: z.string(),
  nextOffset: z.number().int().nonnegative(),
  done: z.boolean(),
});
export const workspaceTransferWriteResultSchema = z.object({
  nextOffset: z.number().int().nonnegative(),
});
export const workspaceTransferRestoredSchema = z.object({
  workspacePath: z.string().min(1),
  providerThreadId: z.string().uuid(),
});
