import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import type { CreateProjectRequest } from "@kaioken/server-contract";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import { reportRemoteWriteFailure } from "@/lib/federation/remote-write-errors";
import { invalidateRemoteServerSnapshot } from "../cache-owners/federation-cache-owner";

export function useCreateRemoteProject(server: FederatedServer) {
  const queryClient = useQueryClient();
  return useMutation({
    meta: { showErrorToast: false },
    mutationFn: (request: CreateProjectRequest) =>
      getRemoteSdk(server.url).projects.create(request),
    onError: (error) => {
      reportRemoteWriteFailure(server, "new project", error);
    },
    onSuccess: () => {
      invalidateRemoteServerSnapshot({ queryClient, handle: server.handle });
    },
  });
}
