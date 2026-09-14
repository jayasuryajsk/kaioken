import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import type { SendMessageRequest } from "@kaioken/server-contract";
import { appToast } from "@/components/ui/app-toast";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import { KaiokenHttpError } from "@/lib/sdk";
import { invalidateRemoteThreadQueries } from "../queries/remote-thread-queries";
import { remoteServerSnapshotQueryKey } from "../queries/federation-queries";

export function describeRemoteWriteFailure(
  serverName: string,
  action: string,
  error: unknown,
): string {
  if (error instanceof KaiokenHttpError) {
    if (error.status === 401) {
      return `${serverName} rejected the ${action}: this device is not signed in there.`;
    }
    if (error.status === 503 || error.status === 0) {
      return `${serverName} is unreachable right now, so the ${action} was not sent.`;
    }
    return `${serverName} could not complete the ${action} (HTTP ${error.status}).`;
  }
  return `${serverName} could not complete the ${action}.`;
}

export function reportRemoteWriteFailure(
  server: FederatedServer,
  action: string,
  error: unknown,
): void {
  appToast.error(describeRemoteWriteFailure(server.name, action, error), {
    description: "Nothing changed on this Kaioken.",
  });
}

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
      void queryClient.invalidateQueries({
        queryKey: remoteServerSnapshotQueryKey(server.handle),
      });
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
