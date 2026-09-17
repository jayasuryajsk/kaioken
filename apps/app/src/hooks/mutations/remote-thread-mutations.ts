import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import type {
  CreateThreadRequest,
  SendMessageRequest,
} from "@kaioken/server-contract";
import { reportRemoteWriteFailure } from "@/lib/federation/remote-write-errors";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import {
  invalidateRemoteServerSnapshot,
  invalidateRemoteThreadQueries,
} from "../cache-owners/federation-cache-owner";

export function useSendRemoteThreadMessage(server: FederatedServer) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: ({
      threadId,
      ...request
    }: SendMessageRequest & { threadId: string }) =>
      getRemoteSdk(server.url).threads.send({ threadId, ...request }),
    onError: (error) => {
      reportRemoteWriteFailure(server, "reply", error);
    },
    onSettled: (_result, _error, variables) => {
      invalidateRemoteThreadQueries({
        queryClient,
        handle: server.handle,
        threadId: variables.threadId,
      });
      invalidateRemoteServerSnapshot({ queryClient, handle: server.handle });
    },
  });
}

export function useStopRemoteThread(server: FederatedServer) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: (threadId: string) =>
      getRemoteSdk(server.url).threads.stop({ threadId }),
    onError: (error) => {
      reportRemoteWriteFailure(server, "stop", error);
    },
    onSettled: (_result, _error, threadId) => {
      invalidateRemoteThreadQueries({
        queryClient,
        handle: server.handle,
        threadId,
      });
    },
  });
}

export type RemoteCreateThreadRequest = Omit<
  CreateThreadRequest,
  "origin" | "startedOnBehalfOf" | "originKind"
>;

export function useCreateRemoteThread(server: FederatedServer) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: (request: RemoteCreateThreadRequest) =>
      getRemoteSdk(server.url).threads.spawn({
        ...request,
        origin: "app",
        originKind: null,
        startedOnBehalfOf: null,
      }),
    onError: (error) => {
      reportRemoteWriteFailure(server, "new thread", error);
    },
    onSuccess: () => {
      invalidateRemoteServerSnapshot({ queryClient, handle: server.handle });
    },
  });
}
