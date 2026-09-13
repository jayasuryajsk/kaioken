import { useMutation, useQueryClient } from "@tanstack/react-query";
import type {
  CodexHandoffResponse,
  CodexSyncResponse,
  ThreadResponse,
} from "@kaioken/server-contract";
import { sdk } from "@/lib/sdk";
import { appToast } from "@/components/ui/app-toast";
import { copyToClipboardWithToast } from "@/lib/clipboard";
import {
  allCodexSessionsQueryKeyPrefix,
  codexThreadLinkQueryKey,
  sidebarNavigationQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
  threadsQueryKey,
} from "@/hooks/queries/query-keys";

export function useImportCodexSession() {
  const queryClient = useQueryClient();
  return useMutation<ThreadResponse, Error, { id: string }>({
    mutationFn: ({ id }) => sdk.codex.sessions.import({ id, origin: "app" }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: allCodexSessionsQueryKeyPrefix(),
        }),
        queryClient.invalidateQueries({ queryKey: threadsQueryKey() }),
        queryClient.invalidateQueries({
          queryKey: sidebarNavigationQueryKey(),
        }),
      ]);
    },
  });
}

export function useCodexHandoff() {
  const queryClient = useQueryClient();
  return useMutation<CodexHandoffResponse, Error, { threadId: string }>({
    mutationFn: ({ threadId }) => sdk.threads.codex.handoff({ threadId }),
    onSuccess: async (result, { threadId }) => {
      appToast.success("Ready to continue in Codex", {
        description: result.command,
        duration: 12_000,
        action: {
          label: "Copy",
          onClick: () => {
            void copyToClipboardWithToast(result.command, {
              successMessage: "Command copied",
              errorMessage: "Failed to copy command",
            });
          },
        },
      });
      await queryClient.invalidateQueries({
        queryKey: codexThreadLinkQueryKey(threadId),
      });
    },
  });
}

export function useCodexSync() {
  const queryClient = useQueryClient();
  return useMutation<CodexSyncResponse, Error, { threadId: string }>({
    mutationFn: ({ threadId }) => sdk.threads.codex.sync({ threadId }),
    onSuccess: async (result, { threadId }) => {
      appToast.success(
        result.appendedTurns === 0
          ? "Nothing new in Codex"
          : `Pulled ${result.appendedTurns} ${
              result.appendedTurns === 1 ? "turn" : "turns"
            } from Codex`,
      );
      await Promise.all([
        queryClient.invalidateQueries({
          queryKey: codexThreadLinkQueryKey(threadId),
        }),
        queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) }),
        queryClient.invalidateQueries({
          queryKey: threadTimelineQueryKey(threadId),
        }),
        queryClient.invalidateQueries({ queryKey: threadsQueryKey() }),
      ]);
    },
  });
}
