import { useCallback, useState } from "react";
import { normalizeProjectPathInput } from "@kaioken/domain";
import type { HostPlatform } from "@kaioken/host-daemon-contract";
import { useDialogState } from "@/hooks/useDialogState";
import { useHostDaemon } from "@/hooks/useHostDaemon";
import {
  selectPersistentHosts,
  useHosts,
  usePrimaryHost,
} from "@/hooks/queries/host-queries";
import { sdk } from "@/lib/sdk";
import type {
  ProjectPathDialogSubmitHandler,
  ProjectPathDialogTarget,
} from "@/components/dialogs/ProjectPathDialog";

export interface LocalPathSubmitParams {
  path: string;
  hostId: string;
  target: ProjectPathDialogTarget;
  closeDialog: () => void;
}

interface UseLocalPathPickerOptions {
  isPending: boolean;
  submit: (params: LocalPathSubmitParams) => void;
}

interface LocalPathPickerController {
  isAvailable: boolean;
  hostId: string | null;
  hostName: string | null;
  openPathEntry: (
    target: ProjectPathDialogTarget,
    preferredHostId?: string | null,
  ) => void;
  openPicker: (target: ProjectPathDialogTarget) => void;
  platform: HostPlatform | null;
  projectPathDialog: ReturnType<typeof useDialogState<ProjectPathDialogTarget>>;
  submitProjectPath: ProjectPathDialogSubmitHandler;
}

interface PathPickerHost {
  canUseNativeFolderPicker: boolean;
  clientHostId: string | null;
  hostId: string | null;
  hostName: string | null;
}

export function usePathPickerHost(): PathPickerHost {
  const { localDaemonHostId, supportsNativeFolderPicker } = useHostDaemon();
  const primaryHost = usePrimaryHost();

  const connectedPrimaryHostId =
    primaryHost?.status === "connected" ? primaryHost.id : null;
  const hostId = connectedPrimaryHostId ?? localDaemonHostId;
  const hostName =
    primaryHost && primaryHost.id === hostId ? primaryHost.name : null;
  const canUseNativeFolderPicker =
    supportsNativeFolderPicker &&
    localDaemonHostId !== null &&
    hostId === localDaemonHostId;

  return {
    canUseNativeFolderPicker,
    clientHostId: localDaemonHostId,
    hostId,
    hostName,
  };
}

export function useLocalPathPicker({
  isPending,
  submit,
}: UseLocalPathPickerOptions): LocalPathPickerController {
  const { platform } = useHostDaemon();
  const defaultPickerHost = usePathPickerHost();
  const hostsQuery = useHosts();
  const isLoadingHosts = hostsQuery.isPending;
  const persistentHosts = selectPersistentHosts(hostsQuery.data);
  const connectedHostCount = persistentHosts.filter(
    (host) => host.status === "connected",
  ).length;
  const [preferredHostId, setPreferredHostId] = useState<string | null>(null);
  const findConnectedHost = useCallback(
    (candidate: string | null) =>
      candidate === null
        ? undefined
        : persistentHosts.find(
            (host) => host.id === candidate && host.status === "connected",
          ),
    [persistentHosts],
  );
  const preferredHost = findConnectedHost(preferredHostId);
  const clientHostId = defaultPickerHost.clientHostId;
  const hostId = preferredHost?.id ?? defaultPickerHost.hostId;
  const hostName = preferredHost?.name ?? defaultPickerHost.hostName;
  const canUseNativeFolderPicker =
    defaultPickerHost.canUseNativeFolderPicker && hostId === clientHostId;
  const projectPathDialog = useDialogState<ProjectPathDialogTarget>();
  const closeDialog = projectPathDialog.onClose;

  const submitPath = useCallback(
    (
      path: string,
      target: ProjectPathDialogTarget,
      targetHostId: string | null,
    ) => {
      if (isPending || !targetHostId) return;
      submit({ path, hostId: targetHostId, target, closeDialog });
    },
    [closeDialog, isPending, submit],
  );

  const openPicker = useCallback(
    (target: ProjectPathDialogTarget) => {
      if (isPending || !hostId) return;

      if (canUseNativeFolderPicker && clientHostId !== null) {
        void (async () => {
          let selectedPath: string | null;
          try {
            selectedPath = (
              await sdk.hosts.pickFolder({ hostId, clientHostId })
            ).path;
          } catch {
            projectPathDialog.onOpen(target);
            return;
          }
          if (!selectedPath) return;
          submitPath(normalizeProjectPathInput(selectedPath), target, hostId);
        })();
        return;
      }

      projectPathDialog.onOpen(target);
    },
    [
      canUseNativeFolderPicker,
      clientHostId,
      hostId,
      isPending,
      projectPathDialog,
      submitPath,
    ],
  );

  const submitProjectPath = useCallback<ProjectPathDialogSubmitHandler>(
    (target, path, selectedHostId) => {
      submitPath(path, target, selectedHostId);
    },
    [submitPath],
  );

  const openPathEntry = useCallback(
    (target: ProjectPathDialogTarget, nextPreferredHostId?: string | null) => {
      const requested =
        typeof nextPreferredHostId === "string" ? nextPreferredHostId : null;
      const requestedHost = findConnectedHost(requested);
      setPreferredHostId(requestedHost?.id ?? null);
      if (
        isLoadingHosts ||
        (requestedHost === undefined && connectedHostCount > 1) ||
        (requestedHost !== undefined && requestedHost.id !== clientHostId)
      ) {
        projectPathDialog.onOpen(target);
        return;
      }
      openPicker(target);
    },
    [
      clientHostId,
      connectedHostCount,
      findConnectedHost,
      isLoadingHosts,
      openPicker,
      projectPathDialog,
    ],
  );

  return {
    isAvailable: hostId != null,
    hostId,
    hostName,
    openPathEntry,
    openPicker,
    platform,
    projectPathDialog,
    submitProjectPath,
  };
}
