import { useState } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { isUnreadDoneThread } from "@kaioken/client-core";
import {
  PERSONAL_PROJECT_ID,
  type PendingInteraction,
  type PendingInteractionApprovalDecision,
  type ThreadListEntry,
} from "@kaioken/domain";
import { buildPendingInteractionApprovalResolution } from "@kaioken/core-ui";
import { Button } from "@kaioken/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kaioken/shared-ui/dropdown-menu";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { useSidebarProjectName } from "@/components/thread/ThreadTitleMentions";
import { useResolveThreadPendingInteraction } from "@/hooks/mutations/thread-interaction-mutations";
import { useThreadPendingInteractions } from "@/hooks/queries/thread-queries";
import { getThreadRoutePath } from "@/lib/route-paths";
import {
  describeNeedsYouRequest,
  formatWaitDuration,
  type NeedsYouRequest,
} from "@/lib/sidebar-unified";
import { getThreadDisplayTitle } from "@/lib/thread-title";
import { SIDEBAR_CONTROL_BUTTON_CLASS } from "./sidebarRowClasses";

interface NeedsYouCardProps {
  thread: ThreadListEntry;
  machine: { name: string; remote: boolean } | null;
  isActive: boolean;
  now: number;
  onProjectSelect?: () => void;
}

const CARD_ACTION_CLASS = "h-6 px-2 text-xs";

function activeInteraction(
  interactions: readonly PendingInteraction[] | undefined,
): PendingInteraction | null {
  if (interactions === undefined) return null;
  return (
    interactions.find(
      (interaction) =>
        interaction.status === "pending" || interaction.status === "resolving",
    ) ?? null
  );
}

function fallbackRequest(thread: ThreadListEntry): NeedsYouRequest {
  if (thread.queuedWork === "failed") {
    return { kind: "input", summary: "A queued message failed" };
  }
  if (thread.status === "error") {
    return { kind: "input", summary: "The last turn failed" };
  }
  return { kind: "input", summary: "Needs your input" };
}

export function NeedsYouCard({
  thread,
  machine,
  isActive,
  now,
  onProjectSelect,
}: NeedsYouCardProps) {
  const navigate = useNavigate();
  const projectName = useSidebarProjectName(
    thread.projectId === PERSONAL_PROJECT_ID ? null : thread.projectId,
  );
  const title = getThreadDisplayTitle(thread);
  const route = getThreadRoutePath({
    projectId: thread.projectId,
    threadId: thread.id,
  });
  const pendingQuery = useThreadPendingInteractions(thread.id, {
    enabled: thread.hasPendingInteraction,
  });
  const interaction = activeInteraction(pendingQuery.data);
  const request =
    interaction === null
      ? fallbackRequest(thread)
      : describeNeedsYouRequest(interaction);
  const resolve = useResolveThreadPendingInteraction();
  const [pendingDecision, setPendingDecision] =
    useState<PendingInteractionApprovalDecision | null>(null);
  const busy =
    resolve.isPending || interaction?.status === "resolving" || false;
  const decide = (decision: PendingInteractionApprovalDecision) => {
    if (interaction === null) return;
    setPendingDecision(decision);
    void resolve
      .mutateAsync({
        threadId: thread.id,
        interactionId: interaction.id,
        resolution: buildPendingInteractionApprovalResolution(
          interaction,
          decision,
        ),
      })
      .catch(() => {})
      .finally(() => setPendingDecision(null));
  };
  const open = () => {
    onProjectSelect?.();
    void navigate(route);
  };
  const location = projectName ?? machine?.name ?? "Kaioken";
  const unread = isUnreadDoneThread(thread);
  const wait = formatWaitDuration(Math.max(0, now - thread.latestAttentionAt));
  const decisions =
    request.kind === "approval" ? request.decisions : ([] as const);
  const canAllow = decisions.includes("allow_once");
  const canAllowSession = decisions.includes("allow_for_session");
  const canDeny = decisions.includes("deny");

  return (
    <div
      data-testid="needs-you-card"
      data-sidebar-thread-id={thread.id}
      className={cn(
        "flex flex-col gap-1.5 rounded-md border border-sidebar-border px-2 py-1.5 text-sm transition-colors",
        isActive ? "bg-sidebar-accent" : "bg-sidebar hover:bg-sidebar-accent",
      )}
    >
      <NavLink
        to={route}
        onClick={onProjectSelect}
        className="flex min-w-0 flex-col outline-none focus-visible:ring-1 focus-visible:ring-sidebar-ring"
      >
        <span className="flex min-w-0 items-center gap-2">
          <span
            className={cn(
              "min-w-0 flex-1 truncate text-sidebar-foreground",
              unread && "font-medium",
            )}
          >
            {title}
          </span>
          <span
            data-testid="needs-you-wait"
            className="shrink-0 text-xs text-subtle-foreground"
          >
            {wait}
          </span>
        </span>
        <span
          data-testid="timeline-row-meta"
          className="flex min-w-0 items-center gap-1 text-xs text-muted-foreground"
        >
          <Icon
            name={machine?.remote ? "Laptop" : "Folder"}
            className="size-3 shrink-0"
          />
          <span className="min-w-0 truncate">
            {location}
            {machine?.remote && projectName !== null ? (
              <span className="text-subtle-foreground"> · {machine.name}</span>
            ) : null}
          </span>
        </span>
      </NavLink>
      <p
        data-testid="needs-you-summary"
        className={cn(
          "truncate text-xs text-foreground",
          request.kind === "approval" && "font-mono",
        )}
        title={request.summary}
      >
        {request.summary}
      </p>
      <div className="flex items-center gap-1">
        {request.kind === "approval" && interaction !== null ? (
          <>
            {canAllow ? (
              <Button
                type="button"
                size="sm"
                variant="default"
                className={CARD_ACTION_CLASS}
                disabled={busy}
                onClick={() => decide("allow_once")}
              >
                {pendingDecision === "allow_once" ? (
                  <Icon name="Spinner" className="size-3 animate-spin" />
                ) : null}
                Allow
              </Button>
            ) : null}
            {canDeny ? (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className={CARD_ACTION_CLASS}
                disabled={busy}
                onClick={() => decide("deny")}
              >
                Deny
              </Button>
            ) : null}
            {canAllowSession ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="More approval options"
                    className={cn(SIDEBAR_CONTROL_BUTTON_CLASS, "ml-auto")}
                    disabled={busy}
                  >
                    <Icon name="MoreHorizontal" className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" mobileTitle="Approval">
                  <DropdownMenuItem
                    onSelect={() => decide("allow_for_session")}
                  >
                    Allow for session
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </>
        ) : (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={CARD_ACTION_CLASS}
            onClick={open}
          >
            {request.kind === "question" ? "Reply" : "Open"}
          </Button>
        )}
      </div>
    </div>
  );
}
