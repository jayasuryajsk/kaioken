import { useCallback, useEffect, useRef, useState } from "react";
import type { ReasoningLevel, ThreadStatus } from "@kaioken/domain";
import {
  buildAutoFollowUpRequest,
  buildThreadHandoffLocationState,
  type FollowUpExecutionSelection,
} from "@kaioken/client-core";
import { Button } from "@kaioken/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kaioken/shared-ui/dialog";
import { Icon } from "@kaioken/shared-ui/icon";
import type { SavedModelSelection } from "@/components/pickers/ModelReasoningPicker";
import type { ProviderPickerOption } from "@/components/pickers/model-brand-prefix";
import { getProjectComposeRoutePath } from "@/lib/route-paths";
import { useScopedSdk } from "@/lib/federation/remote-server-context";
import type { SendMessageMutationLike } from "./threadDetailMutationTypes";

export const HANDOFF_SUMMARY_PROMPT =
  "Write a handoff summary for another agent that will continue this work without seeing this thread: the goal, what was done and where, decisions and why, current state, open problems, exact next steps. Markdown, under 400 words, summary only.";

export interface ProviderHandoffTarget {
  providerId: string;
  providerLabel: string;
  model: string;
  reasoningLevel: ReasoningLevel | null;
}

type ProviderHandoffPhase =
  | { kind: "confirm" }
  | { kind: "summarizing" }
  | { kind: "failed"; message: string };

export interface ProviderHandoffState {
  target: ProviderHandoffTarget;
  phase: ProviderHandoffPhase;
}

interface UseProviderHandoffArgs {
  thread: {
    id: string;
    projectId: string;
    environmentId: string | null;
    status: ThreadStatus;
  };
  sourceThreadTitle: string;
  providerOptions: readonly ProviderPickerOption[];
  execution: FollowUpExecutionSelection;
  sendMessage: Pick<SendMessageMutationLike, "mutateAsync">;
  navigate: (path: string, options: { state: unknown }) => void;
}

const BUSY_STATUSES: ReadonlySet<ThreadStatus> = new Set([
  "starting",
  "active",
  "stopping",
]);

function describeError(error: unknown): string {
  return error instanceof Error && error.message.length > 0
    ? error.message
    : "The handoff could not be completed.";
}

export function useProviderHandoff({
  thread,
  sourceThreadTitle,
  providerOptions,
  execution,
  sendMessage,
  navigate,
}: UseProviderHandoffArgs) {
  const sdk = useScopedSdk();
  const [storedState, setState] = useState<ProviderHandoffState | null>(null);
  const sawBusyRef = useRef(false);
  const canStart = thread.status === "idle";
  const state: ProviderHandoffState | null =
    storedState !== null &&
    storedState.phase.kind === "summarizing" &&
    thread.status === "error"
      ? {
          target: storedState.target,
          phase: {
            kind: "failed",
            message:
              "The thread stopped with an error before writing the summary.",
          },
        }
      : storedState;

  const request = useCallback(
    (selection: SavedModelSelection) => {
      const providerLabel =
        providerOptions.find((option) => option.value === selection.providerId)
          ?.label ?? selection.providerId;
      setState({
        target: {
          providerId: selection.providerId,
          providerLabel,
          model: selection.model,
          reasoningLevel: selection.reasoningLevel ?? null,
        },
        phase: { kind: "confirm" },
      });
    },
    [providerOptions],
  );

  const cancel = useCallback(() => {
    setState(null);
  }, []);

  const confirm = useCallback(async () => {
    const state = storedState;
    if (state === null || state.phase.kind === "summarizing") {
      return;
    }
    const summaryRequest = buildAutoFollowUpRequest({
      threadId: thread.id,
      input: [{ type: "text", text: HANDOFF_SUMMARY_PROMPT, mentions: [] }],
      execution,
    });
    if (summaryRequest === null) {
      setState({
        target: state.target,
        phase: {
          kind: "failed",
          message:
            "Execution options are still loading. Try again in a moment.",
        },
      });
      return;
    }
    sawBusyRef.current = false;
    setState({
      target: state.target,
      phase: { kind: "summarizing" },
    });
    try {
      await sendMessage.mutateAsync(summaryRequest);
    } catch (error) {
      setState({
        target: state.target,
        phase: { kind: "failed", message: describeError(error) },
      });
    }
  }, [execution, sendMessage, storedState, thread.id]);

  const target = state?.target ?? null;
  const isSummarizing = state?.phase.kind === "summarizing";
  useEffect(() => {
    if (!isSummarizing || target === null) {
      return;
    }
    if (BUSY_STATUSES.has(thread.status)) {
      sawBusyRef.current = true;
      return;
    }
    if (thread.status !== "idle" || !sawBusyRef.current) {
      return;
    }
    let cancelled = false;
    sdk.threads
      .output({ threadId: thread.id })
      .then((result) => {
        if (cancelled) return;
        navigate(getProjectComposeRoutePath(thread.projectId), {
          state: buildThreadHandoffLocationState({
            environmentId: thread.environmentId,
            projectId: thread.projectId,
            sourceThreadId: thread.id,
            sourceThreadTitle,
            summary: result.output,
            target: {
              providerId: target.providerId,
              model: target.model,
              reasoningLevel: target.reasoningLevel,
            },
          }),
        });
        setState(null);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({
          target,
          phase: { kind: "failed", message: describeError(error) },
        });
      });
    return () => {
      cancelled = true;
    };
  }, [
    isSummarizing,
    navigate,
    sourceThreadTitle,
    target,
    thread.environmentId,
    thread.id,
    thread.projectId,
    thread.status,
    sdk,
  ]);

  return { state, canStart, request, cancel, confirm };
}

interface ProviderHandoffDialogProps {
  state: ProviderHandoffState | null;
  canStart: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ProviderHandoffDialog({
  state,
  canStart,
  onCancel,
  onConfirm,
}: ProviderHandoffDialogProps) {
  const target = state?.target ?? null;
  const phase = state?.phase ?? null;
  const isSummarizing = phase?.kind === "summarizing";
  return (
    <Dialog
      open={state !== null}
      onOpenChange={(open) => {
        if (!open) onCancel();
      }}
    >
      <DialogContent>
        {target ? (
          <>
            <DialogHeader>
              <DialogTitle>
                Continue in a new {target.providerLabel} thread?
              </DialogTitle>
              <DialogDescription>
                {target.model.length > 0
                  ? `${target.providerLabel} · ${target.model}. `
                  : ""}
                The current model writes a summary of this thread first. A new
                thread then starts with that summary and a link back here. This
                thread stays as it is.
              </DialogDescription>
            </DialogHeader>
            {phase?.kind === "failed" ? (
              <p className="text-sm text-destructive-text" role="alert">
                {phase.message}
              </p>
            ) : null}
            {isSummarizing ? (
              <p
                className="flex items-center gap-2 text-sm text-muted-foreground"
                role="status"
              >
                <Icon name="Spinner" className="size-4 animate-spin" />
                Writing the summary…
              </p>
            ) : !canStart ? (
              <p className="text-sm text-muted-foreground">
                Wait for the thread to finish before handing off.
              </p>
            ) : null}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={onCancel}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onConfirm}
                disabled={isSummarizing || !canStart}
              >
                Hand off
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
