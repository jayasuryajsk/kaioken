import { z } from "zod";
import { workspaceDraftSchema } from "./workspace-drafts";

const messageBase = { nonce: z.string().uuid(), navigationId: z.string() };
export const workspaceHostMessageSchema = z.discriminatedUnion("type", [
  z.object({
    ...messageBase,
    type: z.literal("kaioken:workspace-handoff"),
    threadId: z.string().min(1),
  }),
  z.object({
    ...messageBase,
    type: z.literal("kaioken:workspace-draft-accepted"),
    draftId: z.string().uuid(),
  }),
  z.object({
    ...messageBase,
    type: z.literal("kaioken:workspace-ready"),
    serverId: z.string().uuid(),
  }),
  z.object({
    ...messageBase,
    type: z.literal("kaioken:workspace-location"),
    path: z.string(),
  }),
  z.object({
    ...messageBase,
    type: z.literal("kaioken:workspace-state"),
    state: z.enum(["connecting", "connected", "reconnecting"]),
  }),
]);
export const workspaceControllerMessageSchema = z.object({
  ...messageBase,
  type: z.literal("kaioken:workspace-navigate"),
  path: z.string(),
  draft: workspaceDraftSchema.nullable().default(null),
  desktopBrowser: z.boolean().default(false),
});
