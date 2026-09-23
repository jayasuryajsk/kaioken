import type { BrowserBbSdk } from "@kaioken/sdk/browser";
import { useQuery } from "@tanstack/react-query";
import type { ResolvedThreadExecutionOptions } from "@kaioken/domain";
import { useScopedSdk } from "@/lib/federation/remote-server-context";
import {
  readCachedThreadExecutionOptions,
  threadExecutionOptionsCacheKey,
  writeCachedThreadExecutionOptions,
} from "@/lib/thread-execution-options-cache";
import { useThreadDetailRealtimeSubscription } from "@/hooks/useRealtimeSubscription";
import { requireThreadId } from "./query-helpers";
import { threadDefaultExecutionOptionsQueryKey } from "./query-keys";
import { REALTIME_OWNED_NO_FOCUS_QUERY_POLICY } from "./query-policies";

export {
  allThreadDefaultExecutionOptionsQueryKeyPrefix,
  threadDefaultExecutionOptionsQueryKey,
} from "./query-keys";

interface ThreadDefaultExecutionOptionsQueryOptions {
  enabled?: boolean;
  refetchOnMount?: boolean | "always";
  staleTime?: number;
}

async function fetchThreadDefaultExecutionOptions(
  client: BrowserBbSdk,
  threadId: string,
  signal?: AbortSignal,
): Promise<ResolvedThreadExecutionOptions | null> {
  const options = await client.threads.defaultExecutionOptions({
    threadId,
    signal,
  });
  if (options !== null) {
    writeCachedThreadExecutionOptions(
      threadExecutionOptionsCacheKey(threadId),
      options,
    );
  }
  return options;
}

export function useThreadDefaultExecutionOptions(
  id: string,
  options?: ThreadDefaultExecutionOptionsQueryOptions,
) {
  const sdk = useScopedSdk();
  const enabled = (options?.enabled ?? true) && Boolean(id);
  useThreadDetailRealtimeSubscription(id, { enabled });

  return useQuery<ResolvedThreadExecutionOptions | null>({
    queryKey: threadDefaultExecutionOptionsQueryKey(id),
    queryFn: ({ signal }) =>
      fetchThreadDefaultExecutionOptions(
        sdk,
        requireThreadId(id, "useThreadDefaultExecutionOptions"),
        signal,
      ),
    enabled,
    refetchOnMount: options?.refetchOnMount ?? true,
    ...REALTIME_OWNED_NO_FOCUS_QUERY_POLICY,
    staleTime: options?.staleTime,
    placeholderData: () =>
      id
        ? (readCachedThreadExecutionOptions(
            threadExecutionOptionsCacheKey(id),
          ) ?? undefined)
        : undefined,
  });
}
