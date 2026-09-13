import { threadHandoffStateSchema } from "@kaioken/domain";
import { z } from "zod";
import { threadCreateOriginSchema } from "./threads.js";

export const codexSessionSchema = z.object({
  id: z.string(),
  path: z.string(),
  cwd: z.string(),
  originator: z.string(),
  source: z.string(),
  createdAt: z.string().nullable(),
  updatedAt: z.number(),
  firstPrompt: z.string().nullable(),
  archived: z.boolean(),
  importedThreadId: z.string().nullable(),
});
export type CodexSession = z.infer<typeof codexSessionSchema>;

export const codexSessionListQuerySchema = z.object({
  includeArchived: z.enum(["true", "false"]).optional(),
});
export type CodexSessionListQuery = z.infer<typeof codexSessionListQuerySchema>;

export const codexSessionListResponseSchema = z.object({
  sessions: z.array(codexSessionSchema),
  sharedHome: z.string(),
  privateHome: z.string(),
});
export type CodexSessionListResponse = z.infer<
  typeof codexSessionListResponseSchema
>;

export const importCodexSessionRequestSchema = z
  .object({
    id: z.string().min(1),
    projectId: z.string().min(1).optional(),
    origin: threadCreateOriginSchema.default("sdk"),
  })
  .strict();
export type ImportCodexSessionRequest = z.infer<
  typeof importCodexSessionRequestSchema
>;

export const codexThreadLinkResponseSchema = z.object({
  threadId: z.string(),
  providerThreadId: z.string().nullable(),
  sourceProviderThreadId: z.string().nullable(),
  handoffState: threadHandoffStateSchema.nullable(),
  sourceSyncedOrdinal: z.number().int().nullable(),
});
export type CodexThreadLinkResponse = z.infer<
  typeof codexThreadLinkResponseSchema
>;

export const codexHandoffResponseSchema = z.object({
  threadId: z.string(),
  providerThreadId: z.string(),
  rolloutPath: z.string(),
  command: z.string(),
});
export type CodexHandoffResponse = z.infer<typeof codexHandoffResponseSchema>;

export const codexSyncResponseSchema = z.object({
  threadId: z.string(),
  providerThreadId: z.string(),
  rolloutPath: z.string(),
  appendedTurns: z.number().int().nonnegative(),
  appendedEvents: z.number().int().nonnegative(),
});
export type CodexSyncResponse = z.infer<typeof codexSyncResponseSchema>;
