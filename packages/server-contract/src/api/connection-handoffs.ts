import { z } from "zod";
import {
  permissionModeSchema,
  reasoningLevelSchema,
  serviceTierSchema,
  threadEventRowSchema,
} from "@kaioken/domain";
import {
  gitTransferRepositorySchema,
  workspaceTransferManifestSchema,
  workspaceTransferFileSchema,
} from "@kaioken/host-daemon-contract";

export const handoffConnectionSchema = z.object({
  handle: z.string().min(1).nullable(),
  serverId: z.string().uuid(),
});
export type HandoffConnection = z.infer<typeof handoffConnectionSchema>;
export const handoffPreviewRequestSchema = z
  .object({
    source: handoffConnectionSchema,
    sourceThreadId: z.string().min(1),
    destination: handoffConnectionSchema,
  })
  .strict();
export const handoffStartRequestSchema = handoffPreviewRequestSchema
  .extend({ id: z.string().uuid(), destinationProjectId: z.string().min(1) })
  .strict();
export type HandoffStartRequest = z.infer<typeof handoffStartRequestSchema>;
export type HandoffPreviewRequest = z.infer<typeof handoffPreviewRequestSchema>;
export const handoffProjectSchema = z.object({
  id: z.string(),
  name: z.string(),
  hostId: z.string(),
  path: z.string(),
});
export const handoffPreviewSchema = z.object({
  repository: gitTransferRepositorySchema,
  projects: z.array(handoffProjectSchema),
});
export type HandoffPreview = z.infer<typeof handoffPreviewSchema>;
export const handoffStatusSchema = z.object({
  id: z.string().uuid(),
  source: handoffConnectionSchema,
  sourceThreadId: z.string(),
  destination: handoffConnectionSchema,
  destinationProjectId: z.string(),
  destinationThreadId: z.string().nullable(),
  phase: z.enum([
    "preparing",
    "pausing",
    "transferring",
    "restoring",
    "resuming",
    "completing",
    "cancelling",
    "complete",
    "failed",
    "cancelled",
  ]),
  transferredBytes: z.number().nonnegative(),
  totalBytes: z.number().nonnegative(),
  error: z.string().nullable(),
  updatedAt: z.number(),
});
export type HandoffStatus = z.infer<typeof handoffStatusSchema>;
export const handoffActionRequestSchema = z
  .object({ id: z.string().uuid(), action: z.enum(["retry", "cancel"]) })
  .strict();
export const handoffInspectRequestSchema = z
  .object({ threadId: z.string().min(1) })
  .strict();
export const handoffMatchRequestSchema = z
  .object({ repository: gitTransferRepositorySchema })
  .strict();
export const handoffSourceRequestSchema = z
  .object({ id: z.string().uuid(), threadId: z.string().min(1) })
  .strict();
export const handoffAttachmentSchema = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/u),
  sizeBytes: z.number().int().nonnegative(),
});
export const handoffExportSchema = z.object({
  providerId: z.string().min(1),
  manifest: workspaceTransferManifestSchema,
  title: z.string(),
  model: z.string(),
  reasoningLevel: reasoningLevelSchema.nullable(),
  serviceTier: serviceTierSchema.nullable(),
  permissionMode: permissionModeSchema,
  history: z.array(threadEventRowSchema),
  attachments: z.array(handoffAttachmentSchema),
});
export type HandoffExport = z.infer<typeof handoffExportSchema>;
export const handoffReceiveRequestSchema = z
  .object({
    id: z.string().uuid(),
    projectId: z.string().min(1),
    snapshot: handoffExportSchema,
    retryResume: z.boolean().default(false),
  })
  .strict();
export const handoffReceiveResultSchema = z.object({
  threadId: z.string().min(1),
  ready: z.boolean(),
});
export const handoffFileSchema = z.union([
  workspaceTransferFileSchema,
  z.string().regex(/^attachment\.[a-f0-9]{64}$/u),
]);
export const handoffReadRequestSchema = z
  .object({
    id: z.string().uuid(),
    file: handoffFileSchema,
    offset: z.number().int().nonnegative(),
  })
  .strict();
export const handoffWriteRequestSchema = handoffReadRequestSchema
  .extend({ data: z.string().max(1398104), projectId: z.string().min(1) })
  .strict();
export const handoffFinalizeRequestSchema = z
  .object({
    id: z.string().uuid(),
    role: z.enum(["source", "destination"]),
    action: z.enum(["commit", "cancel"]),
  })
  .strict();
