import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAtom } from "jotai";
import { atomWithStorage } from "jotai/utils";
import { useNavigate, Link } from "react-router-dom";
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
import type {
  HandoffConnection,
  HandoffStatus,
  HandoffStartRequest,
} from "@kaioken/server-contract";
import { useConnectedComputers } from "@/hooks/queries/federation-queries";
import { sdk, KaiokenHttpError } from "@/lib/sdk";
import {
  getThreadRoutePath,
  getRemoteThreadRoutePath,
} from "@/lib/route-paths";
import { getMutationErrorMessage } from "@/lib/mutation-errors";
import {
  HANDOFF_REQUEST_EVENT,
  handoffRequestSchema,
  type HandoffRequest,
} from "@/lib/federation/handoff-request";
import {
  readConnectionIdentity,
  rememberConnectionIdentity,
} from "@/lib/federation/connection-identities";
import {
  invalidateFederationQueries,
  setConnectionHandoffStatus,
} from "@/hooks/cache-owners/connection-cache-owner";
import { connectionHandoffQueryKey } from "@/hooks/queries/query-keys";

const activeHandoffIdAtom = atomWithStorage<string | null>(
  "kaioken.connections.handoff",
  null,
);
const pendingStartAtom = atomWithStorage<HandoffStartRequest | null>(
  "kaioken.connections.pendingHandoff",
  null,
);
const phaseLabels: Record<HandoffStatus["phase"], string> = {
  preparing: "Preparing to move",
  pausing: "Pausing the task",
  transferring: "Transferring your task and changes",
  restoring: "Preparing the destination worktree",
  resuming: "Resuming the Codex session",
  completing: "Finishing the move",
  complete: "Task moved",
  failed: "The move needs attention",
  cancelled: "Move cancelled",
  cancelling: "Cancelling the move",
};
export function ConnectionHandoffDialogHost() {
  const [request, setRequest] = useState<HandoffRequest | null>(null);
  const [activeId, setActiveId] = useAtom(activeHandoffIdAtom);
  const [open, setOpen] = useState(false);
  const [pendingStart, setPendingStart] = useAtom(pendingStartAtom);
  useEffect(() => {
    const listener = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const parsed = handoffRequestSchema.safeParse(event.detail);
      if (!parsed.success) return;
      setRequest(parsed.data);
      setOpen(true);
    };
    window.addEventListener(HANDOFF_REQUEST_EVENT, listener);
    return () => window.removeEventListener(HANDOFF_REQUEST_EVENT, listener);
  }, []);
  if (request === null && activeId === null) return null;
  return (
    <ConnectionHandoffDialog
      key={`${request?.handle ?? "local"}:${request?.threadId ?? "active"}`}
      request={request}
      activeId={activeId}
      open={open}
      onOpenChange={setOpen}
      pendingStart={pendingStart}
      onPendingStart={setPendingStart}
      onStarted={setActiveId}
      onDismiss={() => {
        setPendingStart(null);
        setActiveId(null);
        setRequest(null);
        setOpen(false);
      }}
    />
  );
}
function ConnectionHandoffDialog({
  request,
  activeId,
  open,
  onOpenChange,
  onStarted,
  onDismiss,
  pendingStart,
  onPendingStart,
}: {
  request: HandoffRequest | null;
  activeId: string | null;
  pendingStart: HandoffStartRequest | null;
  onPendingStart: (request: HandoffStartRequest | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (id: string) => void;
  onDismiss: () => void;
}) {
  const computers = useConnectedComputers();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [destination, setDestination] = useState<HandoffConnection | null>(
    null,
  );
  const [projectId, setProjectId] = useState("");
  const [operationId] = useState(() => crypto.randomUUID());
  const source = useQuery({
    queryKey: ["handoff-source", request?.handle],
    enabled: request !== null && activeId === null,
    queryFn: async () => {
      const handle = request?.handle ?? null;
      const identity = await sdk.experimental_connections.resolve({ handle });
      const computer = computers.find((entry) => entry.handle === handle);
      if (computer) {
        const pinned = readConnectionIdentity(
          new URL(computer.url).origin,
          computer.handle,
        );
        if (pinned !== null && pinned !== identity.serverId)
          throw new Error(
            "The source computer's Kaioken installation has changed. Reconnect before moving this task.",
          );
      }
      return { handle, serverId: identity.serverId };
    },
    retry: false,
  });
  const status = useQuery({
    queryKey: connectionHandoffQueryKey(activeId),
    enabled: activeId !== null,
    queryFn: ({ signal }) =>
      sdk.experimental_connections.handoffs.get({ id: activeId!, signal }),
    refetchInterval: (query) =>
      query.state.data &&
      ["complete", "failed", "cancelled"].includes(query.state.data.phase)
        ? false
        : 1000,
    retry: false,
  });
  const choose = useMutation({
    mutationFn: async (handle: string | null) => {
      const identity = await sdk.experimental_connections.resolve({ handle });
      const computer = computers.find((entry) => entry.handle === handle);
      if (computer) {
        const origin = new URL(computer.url).origin;
        const pinned = readConnectionIdentity(origin, computer.handle);
        if (pinned !== null && pinned !== identity.serverId)
          throw new Error(
            "This computer's Kaioken installation has changed. Reconnect before moving a task.",
          );
        rememberConnectionIdentity(origin, identity.serverId, computer.handle);
      }
      if (source.data?.serverId === identity.serverId)
        throw new Error("Choose a different destination computer");
      return { handle, serverId: identity.serverId };
    },
    onSuccess: (value) => {
      setDestination(value);
      setProjectId("");
    },
  });
  const preview = useQuery({
    queryKey: ["handoff-preview", request, source.data, destination],
    enabled:
      activeId === null &&
      request !== null &&
      source.data !== undefined &&
      destination !== null,
    queryFn: () =>
      sdk.experimental_connections.handoffs.preview({
        source: source.data!,
        sourceThreadId: request!.threadId,
        destination: destination!,
      }),
    retry: false,
  });
  const selectedProjectId =
    projectId ||
    (preview.data?.projects.length === 1 ? preview.data.projects[0]!.id : "");
  const start = useMutation({
    mutationFn: (input: HandoffStartRequest) =>
      sdk.experimental_connections.handoffs.start(input),
    onMutate: (input) => {
      onPendingStart(input);
      onStarted(input.id);
    },
    onSuccess: (value) => {
      setConnectionHandoffStatus(client, value);
      onPendingStart(null);
    },
  });
  useEffect(() => {
    if (status.data && pendingStart !== null) onPendingStart(null);
  }, [status.data, pendingStart, onPendingStart]);
  const action = useMutation({
    mutationFn: (value: "retry" | "cancel") =>
      sdk.experimental_connections.handoffs[value]({ id: activeId! }),
    onSuccess: (value) => {
      setConnectionHandoffStatus(client, value);
      void status.refetch();
    },
  });
  const current = status.data;
  const error =
    action.error ??
    start.error ??
    choose.error ??
    preview.error ??
    source.error ??
    (pendingStart === null ? status.error : null);
  const sourceName =
    request?.handle === null
      ? "this computer"
      : (computers.find((entry) => entry.handle === request?.handle)?.name ??
        request?.handle);
  const targets = [
    { handle: null, name: "This computer", live: true },
    ...computers.filter((entry) => !entry.home),
  ].filter((entry) => entry.handle !== request?.handle);
  const openDestination = () => {
    if (!current?.destinationThreadId) return;
    navigate(
      current.destination.handle === null
        ? getThreadRoutePath({
            projectId: current.destinationProjectId,
            threadId: current.destinationThreadId,
          })
        : getRemoteThreadRoutePath({
            handle: current.destination.handle,
            threadId: current.destinationThreadId,
          }),
    );
    void invalidateFederationQueries(client);
    onDismiss();
  };
  return (
    <>
      {!open && activeId !== null ? (
        <Button
          variant="secondary"
          className="fixed bottom-4 right-4 z-50 gap-2 shadow-lg"
          onClick={() => onOpenChange(true)}
        >
          <Icon name="Laptop" className="size-4" />
          {current ? phaseLabels[current.phase] : "Task handoff"}
        </Button>
      ) : null}
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {current ? phaseLabels[current.phase] : "Move to computer"}
            </DialogTitle>
            <DialogDescription>
              {activeId === null
                ? `Continue this task from ${sourceName ?? "its current computer"} with its Codex session and Git changes in a new worktree. A running turn will stop before the move.`
                : "You can close this panel while the move continues."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {activeId === null ? (
              <>
                <div className="space-y-1" aria-label="Destination computer">
                  {targets.map((target) => (
                    <button
                      key={target.handle ?? "local"}
                      type="button"
                      disabled={
                        !target.live || choose.isPending || start.isPending
                      }
                      onClick={() => choose.mutate(target.handle)}
                      aria-pressed={
                        destination !== null &&
                        destination.handle === target.handle
                      }
                      className="flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm transition-colors hover:bg-accent aria-pressed:bg-accent disabled:opacity-50"
                    >
                      <Icon
                        name="Laptop"
                        className="size-4 shrink-0 text-muted-foreground"
                      />
                      <span className="flex-1">{target.name}</span>
                      {!target.live ? (
                        <span className="text-xs text-muted-foreground">
                          Offline
                        </span>
                      ) : destination?.handle === target.handle ? (
                        <Icon name="Check" className="size-4" />
                      ) : null}
                    </button>
                  ))}
                  {targets.length === 0 ? (
                    <p className="text-sm text-muted-foreground">
                      Connect another computer in{" "}
                      <Link
                        className="underline"
                        to="/settings/connections"
                        onClick={onDismiss}
                      >
                        Connections settings
                      </Link>
                      .
                    </p>
                  ) : null}
                </div>
                {choose.isPending || preview.isFetching ? (
                  <p role="status" className="text-sm text-muted-foreground">
                    Finding matching projects…
                  </p>
                ) : null}
                {preview.data ? (
                  <div className="space-y-2 border-t border-border pt-4">
                    <p className="text-sm font-medium">Destination project</p>
                    {preview.data.projects.length === 0 ? (
                      <p className="text-sm text-muted-foreground">
                        Add a project with the same Git repository and folder on
                        this computer, then select it again.
                      </p>
                    ) : (
                      preview.data.projects.map((project) => (
                        <button
                          key={project.id}
                          type="button"
                          aria-pressed={selectedProjectId === project.id}
                          onClick={() => setProjectId(project.id)}
                          className="flex w-full items-center gap-3 rounded-lg p-3 text-left text-sm hover:bg-accent aria-pressed:bg-accent"
                        >
                          <Icon name="Folder" className="size-4" />
                          <span className="min-w-0 flex-1">
                            <span className="block">{project.name}</span>
                            <span className="block truncate text-xs text-muted-foreground">
                              {project.path}
                            </span>
                          </span>
                          {selectedProjectId === project.id ? (
                            <Icon name="Check" className="size-4" />
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                ) : null}
              </>
            ) : current ? (
              <div className="space-y-3" role="status">
                <p className="text-sm">
                  {current.phase === "complete"
                    ? "Your task is ready on the destination computer."
                    : current.phase === "failed"
                      ? "Your source task is preserved. Retry the move or cancel to continue there."
                      : current.phase === "cancelled"
                        ? "You can continue on the source computer."
                        : phaseLabels[current.phase]}
                </p>
                {current.phase === "transferring" && current.totalBytes > 0 ? (
                  <progress
                    className="h-2 w-full accent-primary"
                    value={current.transferredBytes}
                    max={current.totalBytes}
                    aria-label="Transfer progress"
                  />
                ) : null}
                {current.error ? (
                  <p className="text-sm text-destructive">{current.error}</p>
                ) : null}
              </div>
            ) : (
              <p role="status" className="text-sm text-muted-foreground">
                {pendingStart !== null
                  ? "Confirming your move request. If the connection was interrupted, retry to continue the same move."
                  : "Loading handoff…"}
              </p>
            )}
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {getMutationErrorMessage({
                  error,
                  fallbackMessage: "The handoff could not continue",
                })}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            {activeId === null ? (
              <>
                <Button variant="ghost" onClick={onDismiss}>
                  Cancel
                </Button>
                <Button
                  disabled={
                    !source.data ||
                    !destination ||
                    !selectedProjectId ||
                    preview.isFetching ||
                    start.isPending
                  }
                  onClick={() =>
                    start.mutate({
                      id: operationId,
                      source: source.data!,
                      sourceThreadId: request!.threadId,
                      destination: destination!,
                      destinationProjectId: selectedProjectId,
                    })
                  }
                >
                  {start.isPending ? "Starting…" : "Move task"}
                </Button>
              </>
            ) : pendingStart !== null && !current ? (
              <>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
                <Button
                  disabled={start.isPending}
                  onClick={() => start.mutate(pendingStart)}
                >
                  {start.isPending ? "Starting…" : "Retry"}
                </Button>
              </>
            ) : current?.phase === "complete" ? (
              <>
                <Button variant="ghost" onClick={onDismiss}>
                  Done
                </Button>
                <Button onClick={openDestination}>Open task</Button>
              </>
            ) : (status.error instanceof KaiokenHttpError &&
                status.error.status === 404) ||
              current?.phase === "cancelled" ? (
              <Button onClick={onDismiss}>Done</Button>
            ) : current?.phase === "failed" ? (
              <>
                <Button
                  variant="ghost"
                  disabled={action.isPending}
                  onClick={() => action.mutate("cancel")}
                >
                  Cancel move
                </Button>
                <Button
                  disabled={action.isPending}
                  onClick={() => action.mutate("retry")}
                >
                  Retry
                </Button>
              </>
            ) : (
              <>
                <Button
                  variant="ghost"
                  disabled={action.isPending || current?.phase === "cancelling"}
                  onClick={() => action.mutate("cancel")}
                >
                  Cancel move
                </Button>
                <Button variant="ghost" onClick={() => onOpenChange(false)}>
                  Close
                </Button>
              </>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
