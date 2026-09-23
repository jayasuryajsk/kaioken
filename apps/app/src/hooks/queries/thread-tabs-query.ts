import { useQuery } from "@tanstack/react-query";
import type { ThreadTabsResponse } from "@kaioken/server-contract";
import { useScopedSdk } from "@/lib/federation/remote-server-context";
import { threadTabsQueryKey } from "./query-keys";
import { RESUME_REFETCH_QUERY_POLICY } from "./query-policies";

interface ThreadTabsQueryOptions {
  enabled?: boolean;
}

export function useThreadTabs(
  threadId: string,
  options?: ThreadTabsQueryOptions,
) {
  const sdk = useScopedSdk();
  const enabled = (options?.enabled ?? true) && threadId.length > 0;

  return useQuery<ThreadTabsResponse>({
    queryKey: threadTabsQueryKey(threadId),
    queryFn: ({ signal }) => sdk.threads.tabs.get({ threadId, signal }),
    enabled,
    ...RESUME_REFETCH_QUERY_POLICY,
  });
}
