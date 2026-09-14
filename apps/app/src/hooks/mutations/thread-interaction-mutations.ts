import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { PendingInteraction } from "@kaioken/domain";
import type { ResolvePendingInteractionRequest } from "@kaioken/server-contract";
import {
  useRemoteServer,
  useScopedSdk,
} from "@/lib/federation/remote-server-context";
import { invalidateThreadPendingInteractionResolutionQueries } from "../cache-owners/mutation-cache-effects";
import { invalidateRemoteThreadQueries } from "../cache-owners/federation-cache-owner";

interface ResolveThreadPendingInteractionMutationRequest {
  threadId: string;
  interactionId: string;
  resolution: ResolvePendingInteractionRequest;
}

export function useResolveThreadPendingInteraction() {
  const queryClient = useQueryClient();
  const remoteServer = useRemoteServer();
  const sdk = useScopedSdk();

  return useMutation({
    meta: {
      errorMessage: "Failed to resolve pending interaction.",
      showErrorToast: false,
    },
    mutationFn: ({
      threadId,
      interactionId,
      resolution,
    }: ResolveThreadPendingInteractionMutationRequest): Promise<PendingInteraction> =>
      sdk.threads.interactions.resolve({
        interactionId,
        resolution,
        threadId,
      }),
    onSuccess: (interaction, variables) => {
      if (remoteServer !== null) {
        invalidateRemoteThreadQueries({
          queryClient,
          handle: remoteServer.handle,
          threadId: variables.threadId,
        });
        return interaction;
      }
      invalidateThreadPendingInteractionResolutionQueries({
        queryClient,
        threadId: variables.threadId,
      });
      return interaction;
    },
  });
}
