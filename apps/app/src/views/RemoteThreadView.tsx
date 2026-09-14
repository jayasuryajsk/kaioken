import { useCallback, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import type { PendingInteraction, PromptTextMention } from "@kaioken/domain";
import type { FederatedServer } from "@kaioken/client-core";
import { EMPTY_ORDERED_MENTION_SUGGESTIONS } from "@kaioken/client-core";
import type { FollowUpSubmitMode } from "@kaioken/client-core";
import { Icon } from "@kaioken/shared-ui/icon";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import {
  formatOfflineMeta,
  useNow,
} from "@/components/sidebar/TimelineThreadList";
import { ThreadPendingInteractionBanner } from "@/components/thread/pending-interactions/ThreadPendingInteractionBanner";
import { ThreadTimelineSurface } from "@/components/thread/timeline/ThreadTimelineSurface";
import {
  FollowUpPromptBox,
  type FollowUpComposerProps,
} from "@/components/promptbox/FollowUpPromptBox";
import type { ExecutionControlsProps } from "@/components/promptbox/ExecutionControls";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import {
  getCompactFollowUpPromptPlaceholder,
  getFollowUpPromptPlaceholder,
} from "@/components/promptbox/follow-up-placeholder";
import { PageShell } from "@/components/ui/page-shell.js";
import { useAccountServers } from "@/hooks/queries/federation-queries";
import {
  useRemoteThread,
  type RemoteRealtimeState,
} from "@/hooks/queries/remote-thread-queries";
import {
  useSendRemoteThreadMessage,
  useStopRemoteThread,
} from "@/hooks/mutations/remote-thread-mutations";
import { getLatestPendingInteraction } from "@/hooks/queries/thread-queries";
import { RemoteServerProvider } from "@/lib/federation/remote-server-context";
import { getThreadDisplayTitle } from "@/lib/thread-title";

const REMOTE_TYPEAHEAD: TypeaheadConfig = {
  mention: {
    results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
    isLoading: false,
    isError: false,
    onQueryChange: () => {},
  },
  command: INERT_TYPEAHEAD_COMMAND_CONFIG,
};

export function remoteThreadMarker(serverName: string): string {
  return `On ${serverName}`;
}

function RemoteThreadHeader({
  server,
  title,
  now,
  realtime,
}: {
  server: FederatedServer;
  title: string;
  now: number;
  realtime: RemoteRealtimeState;
}) {
  return (
    <div className="mb-3 flex min-w-0 items-center gap-2 px-2">
      <h1
        data-testid="remote-thread-title"
        className="min-w-0 flex-1 truncate text-base font-semibold text-foreground"
      >
        {title}
      </h1>
      <span
        data-testid="remote-thread-marker"
        data-realtime={realtime}
        title={
          server.live
            ? realtime === "connected"
              ? `Live updates from ${server.name}`
              : `Polling ${server.name} for updates`
            : formatOfflineMeta(server.lastSeenAt, now)
        }
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-recessed px-2 py-0.5 text-xs text-muted-foreground"
      >
        <MachineStatusDot connected={server.live} />
        <Icon name="ComputerTerminal01" className="size-3" />
        {remoteThreadMarker(server.name)}
      </span>
    </div>
  );
}

interface RemoteComposerProps {
  server: FederatedServer;
  threadId: string;
  runtimeDisplayStatus: FollowUpComposerProps["threadRuntimeDisplayStatus"];
  pendingInteraction: PendingInteraction | null;
  pendingInteractionsLoading: boolean;
  execution: ExecutionControlsProps;
  permissionMode: FollowUpPromptBoxPermission["value"];
}

type FollowUpPromptBoxPermission = Parameters<
  typeof FollowUpPromptBox
>[0]["permission"];

function RemoteComposer({
  server,
  threadId,
  runtimeDisplayStatus,
  pendingInteraction,
  pendingInteractionsLoading,
  execution,
  permissionMode,
}: RemoteComposerProps) {
  const [message, setMessage] = useState("");
  const [mentionRanges, setMentionRanges] = useState<PromptTextMention[]>([]);
  const send = useSendRemoteThreadMessage(server);
  const stop = useStopRemoteThread(server);
  const isBusy =
    runtimeDisplayStatus === "active" ||
    runtimeDisplayStatus === "starting" ||
    runtimeDisplayStatus === "provisioning";
  const isStopping = runtimeDisplayStatus === "stopping" || stop.isPending;
  const handleStop = useCallback(() => {
    stop.mutate(threadId);
  }, [stop, threadId]);
  const submitWith = useCallback(
    (mode: "queue-if-active" | "steer-if-active") => {
      const text = message.trim();
      if (text.length === 0 || send.isPending) return;
      send.mutate(
        {
          threadId,
          input: [{ type: "text", text: message, mentions: mentionRanges }],
          mode,
        },
        {
          onSuccess: () => {
            setMessage("");
            setMentionRanges([]);
          },
        },
      );
    },
    [mentionRanges, message, send, threadId],
  );
  const submitMode = useMemo<FollowUpSubmitMode>(() => {
    if (!server.live) return { kind: "blocked", reason: "unavailable" };
    if (pendingInteractionsLoading) {
      return { kind: "blocked", reason: "loading-pending-interactions" };
    }
    if (pendingInteraction !== null) {
      return { kind: "blocked", reason: "pending-interaction" };
    }
    if (isStopping) return { kind: "blocked", reason: "stopping" };
    if (isBusy) return { kind: "queue", onStop: handleStop };
    return { kind: "ready" };
  }, [
    handleStop,
    isBusy,
    isStopping,
    pendingInteraction,
    pendingInteractionsLoading,
    server.live,
  ]);
  const composer = useMemo<FollowUpComposerProps>(
    () => ({
      history: {
        currentDraft: { text: message, mentions: mentionRanges, attachments: [] },
        entries: [],
        onSelectEntry: () => {},
      },
      isFollowUpSubmitting: send.isPending,
      message,
      mentionRanges,
      onChangeMessage: (value, ranges) => {
        setMessage(value);
        setMentionRanges(ranges);
      },
      onSubmit: () => submitWith("queue-if-active"),
      onModifierSubmit: () => submitWith("steer-if-active"),
      compactPromptPlaceholder:
        getCompactFollowUpPromptPlaceholder(runtimeDisplayStatus),
      promptPlaceholder: `${getFollowUpPromptPlaceholder(runtimeDisplayStatus)} (runs on ${server.name})`,
      canModifierSubmit: isBusy,
      steerActiveThreadOnEnter: false,
      submitMode,
      threadRuntimeDisplayStatus: runtimeDisplayStatus,
    }),
    [
      isBusy,
      mentionRanges,
      message,
      runtimeDisplayStatus,
      send.isPending,
      server.name,
      submitMode,
      submitWith,
    ],
  );
  const pendingInteractionNode =
    pendingInteraction === null ? null : (
      <ThreadPendingInteractionBanner
        interaction={pendingInteraction}
        threadId={threadId}
      />
    );
  const permission = useMemo<FollowUpPromptBoxPermission>(
    () => ({
      value: permissionMode,
      options: [],
      onChange: () => {},
      supported: permissionMode !== undefined,
    }),
    [permissionMode],
  );

  return (
    <div data-testid="remote-thread-composer" data-server={server.handle}>
      <FollowUpPromptBox
        attachments={{ items: [] }}
        stack={null}
        pendingInteraction={pendingInteractionNode}
        composer={composer}
        environmentSummary={null}
        contextWindowUsage={null}
        execution={execution}
        executionReadOnly
        permission={permission}
        permissionReadOnly
        typeahead={REMOTE_TYPEAHEAD}
        suppressPluginComposerCustomizations
        collapseResetKey={`${server.handle}:${threadId}`}
        isPrimaryComposer
      />
    </div>
  );
}

function OfflineComposer({ server, now }: { server: FederatedServer; now: number }) {
  return (
    <div
      data-testid="remote-thread-offline"
      className="mx-auto flex w-full max-w-[760px] items-center gap-2 rounded-lg border border-border bg-surface-recessed px-3 py-2 text-sm text-muted-foreground"
    >
      <MachineStatusDot connected={false} />
      <span className="min-w-0 flex-1 truncate">
        {server.name} is offline · {formatOfflineMeta(server.lastSeenAt, now)}.
        Replies will work when it is back.
      </span>
    </div>
  );
}

export function RemoteThreadView() {
  const params = useParams<{ handle: string; threadId: string }>();
  const handle = params.handle ?? "";
  const threadId = params.threadId ?? "";
  const now = useNow();
  const serversQuery = useAccountServers();
  const server = useMemo(
    () => serversQuery.data?.find((candidate) => candidate.handle === handle),
    [handle, serversQuery.data],
  );
  const { thread, timeline, pendingInteractions, executionOptions, realtime } =
    useRemoteThread(server, threadId);
  const title =
    thread.data === undefined ? threadId : getThreadDisplayTitle(thread.data);
  const runtimeDisplayStatus = thread.data?.runtime.displayStatus ?? "idle";
  const latestPendingInteraction = useMemo(
    () => getLatestPendingInteraction(pendingInteractions.data),
    [pendingInteractions.data],
  );
  const execution = useMemo<ExecutionControlsProps>(() => {
    const resolved = executionOptions.data ?? null;
    return {
      provider: {
        selectedId: thread.data?.providerId,
        hasMultiple: false,
      },
      model: {
        active: resolved === null ? null : { model: resolved.model },
        selected: resolved?.model ?? "",
        options: [],
        moreOptions: [],
        isLoading: executionOptions.isPending,
        loadFailed: executionOptions.isError,
        onChange: () => {},
      },
      reasoning: {
        value: resolved?.reasoningLevel ?? "medium",
        options: [],
        onChange: () => {},
      },
    };
  }, [
    executionOptions.data,
    executionOptions.isError,
    executionOptions.isPending,
    thread.data?.providerId,
  ]);

  if (server === undefined) {
    return (
      <PageShell>
        <p
          data-testid="remote-thread-unknown-server"
          className="px-2 py-4 text-sm text-muted-foreground"
        >
          {serversQuery.isPending
            ? "Looking up this Kaioken…"
            : `No Kaioken with the handle "${handle}" is on this account.`}
        </p>
      </PageShell>
    );
  }

  return (
    <RemoteServerProvider server={server}>
      <PageShell
        footer={
          server.live ? (
            <RemoteComposer
              server={server}
              threadId={threadId}
              runtimeDisplayStatus={runtimeDisplayStatus}
              pendingInteraction={latestPendingInteraction}
              pendingInteractionsLoading={
                pendingInteractions.data === undefined &&
                pendingInteractions.isFetching
              }
              execution={execution}
              permissionMode={executionOptions.data?.permissionMode}
            />
          ) : (
            <OfflineComposer server={server} now={now} />
          )
        }
      >
        <RemoteThreadHeader
          server={server}
          title={title}
          now={now}
          realtime={realtime}
        />
        {server.live ? (
          <ThreadTimelineSurface
            activeThinking={null}
            isThreadTimelinePending={timeline.isPending}
            timelineError={timeline.isError}
            showOngoingIndicator={runtimeDisplayStatus === "active"}
            timelineRows={timeline.data?.rows ?? []}
            threadId={threadId}
            threadRuntimeDisplayStatus={runtimeDisplayStatus}
            workspaceRootPath={undefined}
          />
        ) : (
          <p className="px-2 py-4 text-sm text-muted-foreground">
            {server.name} is offline. This thread will load when it comes back.
          </p>
        )}
      </PageShell>
    </RemoteServerProvider>
  );
}
