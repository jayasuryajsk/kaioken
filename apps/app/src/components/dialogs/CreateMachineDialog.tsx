import { MachineAccessControls } from "@/components/settings/MachineAccessSettings";
import { useSystemConfig } from "@/hooks/queries/system-queries";
import { machineServerAccessReady } from "@/components/machines/machine-server-access";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { useMutation } from "@tanstack/react-query";
import type { MachineLaunchStatus } from "@bb/server-contract";
import { Button } from "@bb/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@bb/shared-ui/dialog";
import { useHosts } from "@/hooks/queries/host-queries";
import { sdk } from "@/lib/sdk";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

const MANUAL_MACHINE_PROVIDER_ID = "manual";

export function CreateMachineDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const hosts = useHosts();
  const close = (next: boolean) => {
    if (!next) void hosts.refetch();
    onOpenChange(next);
  };
  return (
    <Dialog open={open} onOpenChange={close} modal={false}>
      <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto">
        {open && <CreateMachineContent onOpenChange={close} />}
      </DialogContent>
    </Dialog>
  );
}

export function CreateMachineContent({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const config = useSystemConfig();
  const accessReady = machineServerAccessReady(config.data?.serverAccess);
  if (!accessReady) {
    return (
      <MachineAccessGate
        state={
          config.isPending
            ? { status: "checking" }
            : config.isError
              ? { status: "failed", onRetry: () => void config.refetch() }
              : { status: "blocked" }
        }
      >
        <MachineAccessControls onNavigate={() => onOpenChange(false)} />
      </MachineAccessGate>
    );
  }
  return <ManualMachineSetup onOpenChange={onOpenChange} />;
}

export type MachineAccessGateState =
  | { status: "checking" }
  | { status: "failed"; onRetry: () => void }
  | { status: "blocked" };

export function MachineAccessGate({
  state,
  children,
}: {
  state: MachineAccessGateState;
  children: ReactNode;
}) {
  if (state.status === "checking") {
    return (
      <>
        <DialogTitle className="sr-only">Add a machine</DialogTitle>
        <p role="status" className="text-sm text-subtle-foreground">
          Checking machine access…
        </p>
      </>
    );
  }
  if (state.status === "failed") {
    return (
      <>
        <DialogHeader>
          <DialogTitle>Add a machine</DialogTitle>
          <DialogDescription>
            Couldn’t check whether machines can reach this server.
          </DialogDescription>
        </DialogHeader>
        <div className="flex justify-end">
          <Button variant="outline" size="sm" onClick={state.onRetry}>
            Try again
          </Button>
        </div>
      </>
    );
  }
  return (
    <>
      <DialogHeader>
        <DialogTitle>Set up machine access</DialogTitle>
        <DialogDescription>
          A new machine has to reach this server over the network. Choose the
          address it should use.
        </DialogDescription>
      </DialogHeader>
      {children}
    </>
  );
}

export interface EnrollmentCommand {
  value: string;
  expiresAt: number;
}

function enrollmentCommand(
  status: MachineLaunchStatus,
): EnrollmentCommand | null {
  if (status.command === null || status.commandExpiresAt === null) return null;
  return { value: status.command, expiresAt: status.commandExpiresAt };
}

export function ManualMachineSetup({
  onOpenChange,
}: {
  onOpenChange: (open: boolean) => void;
}) {
  const createController = useRef<AbortController | null>(null);
  const createKey = useRef<string | null>(null);
  const [progress, setProgress] = useState("");
  const [launchId, setLaunchId] = useState<string | null>(null);
  const [command, setCommand] = useState<EnrollmentCommand | null>(null);
  useEffect(() => () => createController.current?.abort(), []);
  const createMachine = useMutation({
    meta: { showErrorToast: false },
    mutationFn: async (options: { replaceLaunch: boolean }) => {
      if (options.replaceLaunch) {
        createController.current?.abort();
        createController.current = null;
        if (launchId !== null)
          await sdk.hosts.experimental_cancel({ id: launchId });
        createKey.current = null;
      }
      setProgress("");
      setLaunchId(null);
      setCommand(null);
      const controller = new AbortController();
      createController.current = controller;
      createKey.current ??= crypto.randomUUID();
      try {
        const launch = await sdk.hosts.experimental_submit({
          key: createKey.current,
          machineProviderId: MANUAL_MACHINE_PROVIDER_ID,
          inputs: null,
          signal: controller.signal,
        });
        setLaunchId(launch.id);
        setCommand(enrollmentCommand(launch));
        return await sdk.hosts.experimental_follow({
          id: launch.id,
          signal: controller.signal,
          onProgress: (status) => {
            setProgress(status.step);
            setCommand(enrollmentCommand(status));
            if (status.terminal) createKey.current = null;
          },
        });
      } finally {
        if (createController.current === controller)
          createController.current = null;
      }
    },
    onSuccess: () => onOpenChange(false),
  });
  const start = createMachine.mutate;
  useEffect(() => {
    start({ replaceLaunch: false });
  }, [start]);

  return (
    <ManualMachineSetupView
      command={command}
      progress={progress}
      errorMessage={
        createMachine.isError
          ? getMutationErrorMessage({
              error: createMachine.error,
              fallbackMessage: "Couldn't prepare an enrollment command.",
            })
          : null
      }
      onRetry={() => createMachine.mutate({ replaceLaunch: false })}
      onRegenerate={() => createMachine.mutate({ replaceLaunch: true })}
      onCancelSetup={
        createMachine.isPending && launchId !== null
          ? () =>
              void sdk.hosts.experimental_cancel({ id: launchId }).then(() => {
                createController.current?.abort();
                onOpenChange(false);
              })
          : null
      }
    />
  );
}

export function ManualMachineSetupView({
  command,
  progress,
  errorMessage,
  onRetry,
  onRegenerate,
  onCancelSetup,
}: {
  command: EnrollmentCommand | null;
  progress: string;
  errorMessage: string | null;
  onRetry: () => void;
  onRegenerate: () => void;
  onCancelSetup: (() => void) | null;
}) {
  return (
    <>
      <DialogHeader>
        <DialogTitle>Add a machine</DialogTitle>
        <DialogDescription>
          Run this command on the machine you want to add. It installs bb and
          keeps the machine connected to this server.
        </DialogDescription>
      </DialogHeader>
      {errorMessage === null ? null : (
        <div className="space-y-2">
          <p role="alert" className="text-sm text-destructive-text">
            {errorMessage}
          </p>
          <Button type="button" size="sm" variant="outline" onClick={onRetry}>
            Try again
          </Button>
        </div>
      )}
      {command === null ? (
        errorMessage === null ? (
          <p role="status" className="text-sm text-subtle-foreground">
            {progress === "" ? "Preparing an enrollment command…" : progress}
          </p>
        ) : null
      ) : (
        <MachineLaunchCommand
          key={command.value}
          command={command.value}
          expiresAt={command.expiresAt}
          onRegenerate={onRegenerate}
        />
      )}
      {onCancelSetup === null ? null : (
        <DialogFooter>
          <Button variant="outline" size="sm" onClick={onCancelSetup}>
            Cancel setup
          </Button>
        </DialogFooter>
      )}
    </>
  );
}

function formatRemaining(ms: number): string {
  const totalSeconds = Math.ceil(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes === 0) return `${seconds}s`;
  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

export function MachineLaunchCommand({
  command,
  expiresAt,
  onRegenerate,
}: {
  command: string;
  expiresAt: number;
  onRegenerate: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const [remaining, setRemaining] = useState(() => expiresAt - Date.now());
  useEffect(() => {
    const timer = setInterval(
      () => setRemaining(expiresAt - Date.now()),
      1_000,
    );
    return () => clearInterval(timer);
  }, [expiresAt]);
  const expired = remaining <= 0;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      setCopyFailed(false);
    } catch {
      setCopyFailed(true);
    }
  };
  return (
    <div className="overflow-hidden rounded-md border border-border bg-muted/30">
      <div className="space-y-1 border-b border-border px-3 py-2">
        <p className="text-sm font-medium">Run this command</p>
        <p
          role="status"
          className={
            expired
              ? "text-xs text-destructive-text"
              : "text-xs text-subtle-foreground"
          }
        >
          {expired
            ? "This command has expired."
            : `Expires in ${formatRemaining(remaining)}.`}
        </p>
      </div>
      {expired ? null : (
        <pre className="whitespace-pre-wrap break-all p-3 font-mono text-xs">
          {command}
        </pre>
      )}
      <div className="flex justify-end gap-2 border-t border-border px-3 py-2">
        {expired ? (
          <Button variant="outline" size="sm" onClick={onRegenerate}>
            Generate new command
          </Button>
        ) : (
          <Button variant="outline" size="sm" onClick={() => void copy()}>
            {copied ? "Copied" : "Copy command"}
          </Button>
        )}
      </div>
      {copyFailed ? (
        <p role="alert" className="px-3 pb-3 text-xs text-destructive-text">
          Could not copy the command. Try again.
        </p>
      ) : null}
    </div>
  );
}
