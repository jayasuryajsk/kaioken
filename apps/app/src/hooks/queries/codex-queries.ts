import { useQuery } from "@tanstack/react-query";
import type {
  CodexSessionListResponse,
  CodexThreadLinkResponse,
} from "@kaioken/server-contract";
import { sdk } from "@/lib/sdk";
import { codexSessionsQueryKey, codexThreadLinkQueryKey } from "./query-keys";
import type { QueryOptions } from "./query-helpers";

export const CODEX_PROVIDER_ID = "codex";

export function useCodexSessions(
  args: { includeArchived: boolean } & QueryOptions,
) {
  return useQuery<CodexSessionListResponse>({
    queryKey: codexSessionsQueryKey(args.includeArchived),
    queryFn: ({ signal }) =>
      sdk.codex.sessions.list({
        includeArchived: args.includeArchived,
        signal,
      }),
    enabled: args.enabled ?? true,
    staleTime: 30_000,
  });
}

export function useCodexThreadLink(args: {
  threadId: string;
  providerId: string;
  enabled?: boolean;
}) {
  const enabled =
    (args.enabled ?? true) && args.providerId === CODEX_PROVIDER_ID;
  return useQuery<CodexThreadLinkResponse>({
    queryKey: codexThreadLinkQueryKey(args.threadId),
    queryFn: ({ signal }) =>
      sdk.threads.codex.link({ threadId: args.threadId, signal }),
    enabled,
    staleTime: 30_000,
  });
}
