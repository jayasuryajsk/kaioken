import { useQuery } from "@tanstack/react-query";
import { useCallback } from "react";
import { PERSONAL_PROJECT_ID, type ThreadListEntry } from "@kaioken/domain";
import type { SidebarBootstrapResponse } from "@kaioken/server-contract";
import { listSidebarNavigationThreads } from "@/hooks/cache-owners/query-cache";
import type { BrowserBbSdk } from "@kaioken/sdk/browser";
import {
  useRemoteServer,
  useScopedSdk,
} from "@/lib/federation/remote-server-context";
import {
  useEnvironmentListRealtimeSubscription,
  useHostListRealtimeSubscription,
  useProjectListRealtimeSubscription,
  useThreadListRealtimeSubscription,
} from "@/hooks/useRealtimeSubscription";
import type { QueryOptions } from "./query-helpers";
import { sidebarNavigationQueryKey } from "./query-keys";
import { REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY } from "./query-policies";
import {
  readCachedSidebarBootstrap,
  writeCachedSidebarBootstrap,
} from "@/lib/sidebar-bootstrap-cache";

function fetchSidebarNavigation(
  client: BrowserBbSdk,
  signal?: AbortSignal,
): Promise<SidebarBootstrapResponse> {
  return client.projects.sidebarBootstrap({ signal });
}

export function useSidebarNavigation(options?: QueryOptions) {
  const sdk = useScopedSdk();
  const isLocal = useRemoteServer() === null;
  const enabled = options?.enabled ?? true;
  useEnvironmentListRealtimeSubscription({ enabled });
  useHostListRealtimeSubscription({ enabled });
  useProjectListRealtimeSubscription({ enabled });
  useThreadListRealtimeSubscription({ enabled });

  return useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: async ({ signal }) => {
      const response = await fetchSidebarNavigation(sdk, signal);
      if (isLocal) writeCachedSidebarBootstrap(response);
      return response;
    },
    enabled,
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    placeholderData: () =>
      isLocal ? (readCachedSidebarBootstrap() ?? undefined) : undefined,
  });
}

export function useProjectDisplayName(
  projectId: string | undefined,
): string | undefined {
  const sdk = useScopedSdk();
  const { data } = useQuery<SidebarBootstrapResponse>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(sdk, signal),
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    enabled: Boolean(projectId),
  });
  if (!data || !projectId) {
    return undefined;
  }
  if (projectId === PERSONAL_PROJECT_ID) {
    return data.personalProject.name;
  }
  return data.projects.find((project) => project.id === projectId)?.name;
}

interface SidebarNavigationThreadSelection<T> {
  data: T | undefined;
  isBootstrapPending: boolean;
}

export function useSidebarNavigationThreadSelection<T>(
  select: (threads: ThreadListEntry[]) => T,
): SidebarNavigationThreadSelection<T> {
  const sdk = useScopedSdk();
  const selectFromNavigation = useCallback(
    (navigation: SidebarBootstrapResponse) =>
      select(listSidebarNavigationThreads(navigation)),
    [select],
  );
  const result = useQuery<SidebarBootstrapResponse, Error, T>({
    queryKey: sidebarNavigationQueryKey(),
    queryFn: ({ signal }) => fetchSidebarNavigation(sdk, signal),
    ...REALTIME_OWNED_STATIC_CACHE_QUERY_POLICY,
    enabled: false,
    select: selectFromNavigation,
  });
  const data = result.data;
  return {
    data,
    isBootstrapPending: data === undefined && result.isFetching,
  };
}
