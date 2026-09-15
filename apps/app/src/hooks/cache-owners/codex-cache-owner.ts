import type { QueryClient } from "@tanstack/react-query";
import {
  allCodexSessionsQueryKeyPrefix,
  codexThreadLinkQueryKey,
  sidebarNavigationQueryKey,
  threadQueryKey,
  threadTimelineQueryKey,
  threadsQueryKey,
} from "../queries/query-keys";

export async function invalidateAfterCodexImport(
  queryClient: QueryClient,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: allCodexSessionsQueryKeyPrefix(),
    }),
    queryClient.invalidateQueries({ queryKey: threadsQueryKey() }),
    queryClient.invalidateQueries({ queryKey: sidebarNavigationQueryKey() }),
  ]);
}

export async function invalidateCodexThreadLink(
  queryClient: QueryClient,
  threadId: string,
): Promise<void> {
  await queryClient.invalidateQueries({
    queryKey: codexThreadLinkQueryKey(threadId),
  });
}

export async function invalidateAfterCodexSync(
  queryClient: QueryClient,
  threadId: string,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: codexThreadLinkQueryKey(threadId),
    }),
    queryClient.invalidateQueries({ queryKey: threadQueryKey(threadId) }),
    queryClient.invalidateQueries({
      queryKey: threadTimelineQueryKey(threadId),
    }),
    queryClient.invalidateQueries({ queryKey: threadsQueryKey() }),
  ]);
}
