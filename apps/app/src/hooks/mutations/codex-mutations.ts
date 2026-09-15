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
  invalidateAfterCodexImport,
  invalidateAfterCodexSync,
  invalidateCodexThreadLink,
} from "../cache-owners/codex-cache-owner";

export function useImportCodexSession() {
  const queryClient = useQueryClient();
  return useMutation<ThreadResponse, Error, { id: string }>({
    mutationFn: ({ id }) => sdk.codex.sessions.import({ id, origin: "app" }),
    onSuccess: () => invalidateAfterCodexImport(queryClient),
  });
}

export function useCodexHandoff() {
  const queryClient = useQueryClient();
  return useMutation<CodexHandoffResponse, Error, { threadId: string }>({
    mutationFn: ({ threadId }) => sdk.threads.codex.handoff({ threadId }),
    onSuccess: async (result, { threadId }) => {
      appToast.success(
        result.hostIsServer || result.hostName === null
          ? "Ready to continue in Codex"
          : `Ready to continue in Codex on ${result.hostName}`,
        {
          description: result.hostIsServer
            ? result.command
            : `Run on ${result.hostName ?? result.hostId ?? "that machine"}: ${result.command}`,
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
        },
      );
      await invalidateCodexThreadLink(queryClient, threadId);
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
      await invalidateAfterCodexSync(queryClient, threadId);
    },
  });
}
