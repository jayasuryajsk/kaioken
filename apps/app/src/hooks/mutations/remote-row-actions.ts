import { useMemo } from "react";
import { useQueryClient, type QueryClient } from "@tanstack/react-query";
import { parseRemoteId } from "@kaioken/client-core";
import type { Thread } from "@kaioken/domain";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import type { RemoteTarget } from "@/lib/federation/remote-target";
import {
  invalidateRemoteServerSnapshot,
  invalidateRemoteThreadQueries,
} from "../cache-owners/federation-cache-owner";
import { reportRemoteWriteFailure } from "./remote-thread-mutations";

function rawSectionId(sectionId: string | null): string | null {
  if (sectionId === null) return null;
  return parseRemoteId(sectionId)?.id ?? sectionId;
}

function refreshRemote(
  queryClient: QueryClient,
  target: RemoteTarget,
  threadId?: string,
): void {
  invalidateRemoteServerSnapshot({
    queryClient,
    handle: target.server.handle,
  });
  if (threadId !== undefined) {
    invalidateRemoteThreadQueries({
      queryClient,
      handle: target.server.handle,
      threadId,
    });
  }
}

async function runRemote<T>(
  queryClient: QueryClient,
  target: RemoteTarget,
  action: string,
  run: () => Promise<T>,
  threadId?: string,
): Promise<T | null> {
  try {
    const result = await run();
    refreshRemote(queryClient, target, threadId);
    return result;
  } catch (error) {
    reportRemoteWriteFailure(target.server, action, error);
    return null;
  }
}

export interface RemoteRowActions {
  renameThread: (target: RemoteTarget, title: string) => Promise<boolean>;
  setThreadPinned: (target: RemoteTarget, pinned: boolean) => Promise<boolean>;
  setThreadRead: (target: RemoteTarget, read: boolean) => Promise<boolean>;
  archiveThread: (target: RemoteTarget) => Promise<boolean>;
  unarchiveThread: (target: RemoteTarget) => Promise<boolean>;
  childThreadCount: (target: RemoteTarget) => Promise<number | null>;
  deleteThread: (
    target: RemoteTarget,
    childThreadsConfirmed: boolean,
  ) => Promise<boolean>;
  moveThread: (
    target: RemoteTarget,
    thread: Pick<Thread, "pinnedAt" | "sectionId">,
    sectionId: string | null,
  ) => Promise<boolean>;
  renameProject: (target: RemoteTarget, name: string) => Promise<boolean>;
  deleteProject: (target: RemoteTarget) => Promise<boolean>;
  moveProject: (target: RemoteTarget, sectionId: string | null) => Promise<boolean>;
}

export function useRemoteRowActions(): RemoteRowActions {
  const queryClient = useQueryClient();
  return useMemo<RemoteRowActions>(() => {
    const ok = async (promise: Promise<unknown | null>) =>
      (await promise) !== null;
    return {
      renameThread: (target, title) =>
        ok(
          runRemote(
            queryClient,
            target,
            "rename",
            () =>
              getRemoteSdk(target.server.url).threads.update({
                threadId: target.id,
                title,
              }),
            target.id,
          ),
        ),
      setThreadPinned: (target, pinned) =>
        ok(
          runRemote(queryClient, target, pinned ? "pin" : "unpin", () =>
            pinned
              ? getRemoteSdk(target.server.url).threads.pin({
                  threadId: target.id,
                })
              : getRemoteSdk(target.server.url).threads.unpin({
                  threadId: target.id,
                }),
          ),
        ),
      setThreadRead: (target, read) =>
        ok(
          runRemote(
            queryClient,
            target,
            read ? "mark read" : "mark unread",
            () =>
              read
                ? getRemoteSdk(target.server.url).threads.markRead({
                    threadId: target.id,
                  })
                : getRemoteSdk(target.server.url).threads.markUnread({
                    threadId: target.id,
                  }),
            target.id,
          ),
        ),
      archiveThread: (target) =>
        ok(
          runRemote(
            queryClient,
            target,
            "archive",
            () =>
              getRemoteSdk(target.server.url).threads.archiveAll({
                threadId: target.id,
              }),
            target.id,
          ),
        ),
      unarchiveThread: (target) =>
        ok(
          runRemote(
            queryClient,
            target,
            "unarchive",
            () =>
              getRemoteSdk(target.server.url).threads.unarchive({
                threadId: target.id,
              }),
            target.id,
          ),
        ),
      childThreadCount: async (target) => {
        const summary = await runRemote(
          queryClient,
          target,
          "thread check",
          () =>
            getRemoteSdk(target.server.url).threads.childSummary({
              threadId: target.id,
            }),
        );
        return summary === null ? null : (summary?.nonDeletedChildCount ?? 0);
      },
      deleteThread: (target, childThreadsConfirmed) =>
        ok(
          runRemote(
            queryClient,
            target,
            "delete",
            () =>
              getRemoteSdk(target.server.url).threads.delete({
                threadId: target.id,
                childThreadsConfirmed,
              }),
            target.id,
          ),
        ),
      moveThread: (target, thread, sectionId) =>
        ok(
          runRemote(
            queryClient,
            target,
            "move",
            async () => {
              const remote = getRemoteSdk(target.server.url).threads;
              if (thread.pinnedAt !== null) {
                await remote.unpin({ threadId: target.id });
              }
              if (thread.sectionId !== sectionId) {
                await remote.update({
                  threadId: target.id,
                  sectionId: rawSectionId(sectionId),
                });
              }
              return true;
            },
            target.id,
          ),
        ),
      renameProject: (target, name) =>
        ok(
          runRemote(queryClient, target, "rename", () =>
            getRemoteSdk(target.server.url).projects.update({
              projectId: target.id,
              name,
            }),
          ),
        ),
      deleteProject: (target) =>
        ok(
          runRemote(queryClient, target, "remove", () =>
            getRemoteSdk(target.server.url).projects.delete({
              projectId: target.id,
            }),
          ),
        ),
      moveProject: (target, sectionId) =>
        ok(
          runRemote(queryClient, target, "move", () =>
            getRemoteSdk(target.server.url).projects.update({
              projectId: target.id,
              sectionId: rawSectionId(sectionId),
            }),
          ),
        ),
    };
  }, [queryClient]);
}
