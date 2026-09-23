import { useEffect, useMemo } from "react";
import type { RealtimeSubscriptionTarget } from "@kaioken/server-contract";
import { wsManager } from "@/lib/ws";
import { useRemoteServer } from "@/lib/federation/remote-server-context";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import { subscribeRemoteRealtimeTarget } from "@/lib/federation/remote-scope";

interface RealtimeSubscriptionOptions {
  enabled?: boolean;
}

const THREAD_LIST_TARGET = {
  kind: "thread-list",
} satisfies RealtimeSubscriptionTarget;
const PROJECT_LIST_TARGET = {
  kind: "project-list",
} satisfies RealtimeSubscriptionTarget;
const ENVIRONMENT_LIST_TARGET = {
  kind: "environment-list",
} satisfies RealtimeSubscriptionTarget;
const HOST_LIST_TARGET = {
  kind: "host-list",
} satisfies RealtimeSubscriptionTarget;
const SYSTEM_TARGET = { kind: "system" } satisfies RealtimeSubscriptionTarget;

function useRealtimeSubscription(
  target: RealtimeSubscriptionTarget | null,
  options?: RealtimeSubscriptionOptions,
): void {
  const enabled = options?.enabled ?? true;
  const remoteUrl = useRemoteServer()?.url ?? null;

  useEffect(() => {
    if (!enabled || !target) {
      return;
    }
    if (remoteUrl !== null) {
      return subscribeRemoteRealtimeTarget(getRemoteSdk(remoteUrl), target);
    }

    wsManager.subscribe(target);
    return () => {
      wsManager.unsubscribe(target);
    };
  }, [enabled, target, remoteUrl]);
}

export function useThreadDetailRealtimeSubscription(
  threadId: string | null | undefined,
  options?: RealtimeSubscriptionOptions,
): void {
  const target = useMemo<RealtimeSubscriptionTarget | null>(
    () => (threadId ? { kind: "thread-detail", threadId } : null),
    [threadId],
  );
  useRealtimeSubscription(target, options);
}

export function useEnvironmentDetailRealtimeSubscription(
  environmentId: string | null | undefined,
  options?: RealtimeSubscriptionOptions,
): void {
  const target = useMemo<RealtimeSubscriptionTarget | null>(
    () =>
      environmentId ? { kind: "environment-detail", environmentId } : null,
    [environmentId],
  );
  useRealtimeSubscription(target, options);
}

export function useProjectDetailRealtimeSubscription(
  projectId: string | null | undefined,
  options?: RealtimeSubscriptionOptions,
): void {
  const target = useMemo<RealtimeSubscriptionTarget | null>(
    () => (projectId ? { kind: "project-detail", projectId } : null),
    [projectId],
  );
  useRealtimeSubscription(target, options);
}

export function useThreadListRealtimeSubscription(
  options?: RealtimeSubscriptionOptions,
): void {
  useRealtimeSubscription(THREAD_LIST_TARGET, options);
}

export function useProjectListRealtimeSubscription(
  options?: RealtimeSubscriptionOptions,
): void {
  useRealtimeSubscription(PROJECT_LIST_TARGET, options);
}

export function useEnvironmentListRealtimeSubscription(
  options?: RealtimeSubscriptionOptions,
): void {
  useRealtimeSubscription(ENVIRONMENT_LIST_TARGET, options);
}

export function useHostListRealtimeSubscription(
  options?: RealtimeSubscriptionOptions,
): void {
  useRealtimeSubscription(HOST_LIST_TARGET, options);
}

export function useSystemRealtimeSubscription(
  options?: RealtimeSubscriptionOptions,
): void {
  useRealtimeSubscription(SYSTEM_TARGET, options);
}
