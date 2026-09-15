import { z } from "zod";
import { uploadedPromptAttachmentSchema } from "@kaioken/server-contract";
import type { PromptDraftState } from "@kaioken/client-core";
import type { BrowserBbSdk } from "@kaioken/sdk/browser";
import { getPromptDraftAccessor } from "@/hooks/usePromptDraftStorage";

export const WORKSPACE_DRAFT_PARAM = "connectionDraft";
export const workspaceDraftSchema = z.object({
  id: z.string().uuid(),
  text: z.string(),
  attachments: z.array(uploadedPromptAttachmentSchema),
});
type WorkspaceDraft = z.infer<typeof workspaceDraftSchema>;
const pendingDrafts = new Map<
  string,
  {
    handle: string;
    serverId: string;
    draft: WorkspaceDraft;
    accepted: () => void;
  }
>();

export function workspaceDraftId(search: string): string | null {
  const parsed = z
    .string()
    .uuid()
    .safeParse(new URLSearchParams(search).get(WORKSPACE_DRAFT_PARAM));
  return parsed.success ? parsed.data : null;
}

export async function copyWorkspaceDraft(args: {
  source: Pick<BrowserBbSdk, "projects">;
  destination: Pick<BrowserBbSdk, "projects">;
  sourceProjectId: string;
  destinationProjectId: string;
  draft: PromptDraftState;
}): Promise<WorkspaceDraft> {
  const attachments: WorkspaceDraft["attachments"] = [];
  for (const attachment of args.draft.attachments) {
    const file = await args.source.projects.attachments.read({
      projectId: args.sourceProjectId,
      path: attachment.path,
    });
    attachments.push(
      await args.destination.projects.attachments.upload({
        projectId: args.destinationProjectId,
        clientFile: file.bytes,
        filename: attachment.name,
        mimeType: file.mimeType,
      }),
    );
  }
  return { id: crypto.randomUUID(), text: args.draft.text, attachments };
}

export function queueWorkspaceDraft(
  handle: string,
  serverId: string,
  draft: WorkspaceDraft,
  accepted: () => void,
): void {
  pendingDrafts.set(draft.id, { handle, serverId, draft, accepted });
}

export function pendingWorkspaceDraft(
  handle: string,
  serverId: string,
  path: string,
): WorkspaceDraft | null {
  const id = workspaceDraftId(
    new URL(path, "https://workspace.invalid").search,
  );
  const pending = id === null ? undefined : pendingDrafts.get(id);
  return pending?.handle === handle && pending.serverId === serverId
    ? pending.draft
    : null;
}

export function acknowledgeWorkspaceDraft(
  handle: string,
  serverId: string,
  id: string,
): void {
  const pending = pendingDrafts.get(id);
  if (pending?.handle !== handle || pending.serverId !== serverId) return;
  pendingDrafts.delete(id);
  pending.accepted();
}

export function receiveWorkspaceDraft(draft: WorkspaceDraft): void {
  const accessor = getPromptDraftAccessor({
    kind: "connection-new-thread",
    transferId: draft.id,
  });
  const receiptKey = `kaioken.connection-draft.received:${draft.id}`;
  if (window.sessionStorage.getItem(receiptKey) !== null) return;
  accessor.setDraft({
    text: draft.text,
    attachments: draft.attachments,
    mentions: [],
  });
  window.sessionStorage.setItem(receiptKey, "true");
}
