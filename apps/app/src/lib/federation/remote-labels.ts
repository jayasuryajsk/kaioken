import { useMemo } from "react";
import { namespaceRemoteBootstrap } from "@kaioken/client-core";
import { useFederatedRemotes } from "@/hooks/queries/federation-queries";
import type { RemoteTarget } from "./remote-target";

export interface RemoteLabelDestination {
  label: string;
  sectionId: string | null;
}

export interface RemoteLabels {
  destinations: RemoteLabelDestination[];
  sectionIdByProjectId: Map<string, string>;
}

const NO_REMOTE_LABELS: RemoteLabels = {
  destinations: [],
  sectionIdByProjectId: new Map(),
};

export function useRemoteLabels(target: RemoteTarget | null): RemoteLabels {
  const { remotes } = useFederatedRemotes({ enabled: target !== null });
  return useMemo(() => {
    if (target === null) return NO_REMOTE_LABELS;
    const snapshot = remotes.find(
      (remote) => remote.server.handle === target.server.handle,
    );
    if (snapshot === undefined || snapshot.bootstrap === null) {
      return NO_REMOTE_LABELS;
    }
    const { sections } = namespaceRemoteBootstrap(
      target.server.handle,
      snapshot.bootstrap,
    );
    const sectionIdByProjectId = new Map<string, string>();
    for (const section of sections) {
      for (const projectId of section.projectIds) {
        sectionIdByProjectId.set(projectId, section.id);
      }
    }
    return {
      destinations: [
        { label: "Threads", sectionId: null },
        ...sections.map((section) => ({
          label: section.name,
          sectionId: section.id,
        })),
      ],
      sectionIdByProjectId,
    };
  }, [remotes, target]);
}
