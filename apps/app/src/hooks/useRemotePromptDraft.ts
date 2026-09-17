import { useState } from "react";
import type { FederatedServer } from "@kaioken/client-core";
import { usePromptDraftStorage } from "./usePromptDraftStorage";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";

export function useRemotePromptDraft(
  server: FederatedServer,
  projectId: string,
  key: string,
) {
  const draft = usePromptDraftStorage({
    kind: "plugin-new-thread",
    key: `remote:${server.handle}:${key}`,
  });
  const [pendingUploads, setPendingUploads] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const attach = async (files: File[]) => {
    setPendingUploads((count) => count + 1);
    setError(null);
    try {
      for (const file of files) {
        const uploaded = await getRemoteSdk(
          server.url,
        ).projects.attachments.upload({
          projectId,
          clientFile: file,
          filename: file.name,
          mimeType: file.type || "application/octet-stream",
        });
        draft.addAttachment(uploaded);
      }
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not upload attachment",
      );
    } finally {
      setPendingUploads((count) => count - 1);
    }
  };
  return {
    draft,
    attachments: {
      items: draft.attachments,
      projectId,
      isAttaching: pendingUploads > 0,
      error,
      onAttachFiles: attach,
      onRemove: draft.removeAttachment,
    },
  };
}
