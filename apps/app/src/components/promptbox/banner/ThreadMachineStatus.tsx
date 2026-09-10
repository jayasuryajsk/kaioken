import { useHosts } from "@/hooks/queries/host-queries";
import { useResumeHost } from "@/hooks/mutations/host-mutations";
import { Button } from "@bb/shared-ui/button";
import type { SystemMachineProvider } from "@bb/server-contract";
import { MachineProviderIcon } from "@/components/plugin/MachineProviderIcon";
import { useSystemMachineProviders } from "@/hooks/queries/machine-provider-queries";
import { PromptStackCard } from "./PromptStackCard";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function ThreadMachineStatus({ hostId }: { hostId: string }) {
  const hosts = useHosts();
  const { providers } = useSystemMachineProviders();
  const resume = useResumeHost();
  const host = hosts.data?.find((candidate) => candidate.id === hostId);
  if (!host || host.machineProviderId === null) return null;
  const pausing = host.lifecycle.phase === "suspending";
  const paused = host.lifecycle.phase === "suspended";
  if (!pausing && !paused) return null;
  return (
    <ThreadMachineStatusBanner
      hostName={host.name}
      provider={providers?.find(
        (provider) => provider.id === host.machineProviderId,
      )}
      phase={pausing ? "suspending" : "suspended"}
      resuming={resume.isPending}
      error={
        resume.error
          ? getMutationErrorMessage({
              error: resume.error,
              fallbackMessage: "Could not resume the machine.",
            })
          : null
      }
      onResume={() => resume.mutate(hostId)}
    />
  );
}

export function ThreadMachineStatusBanner({
  hostName,
  provider,
  phase,
  resuming,
  error,
  onResume,
}: {
  hostName: string;
  provider: SystemMachineProvider | undefined;
  phase: "suspending" | "suspended";
  resuming: boolean;
  error: string | null;
  onResume: () => void;
}) {
  return (
    <PromptStackCard ariaLabel="Machine status">
      <div className="flex min-h-8 items-start gap-2 px-3 py-1.5 text-xs">
        {provider ? (
          <MachineProviderIcon
            provider={provider}
            className="mt-1.5 size-3.5 shrink-0 text-muted-foreground"
          />
        ) : null}
        <div className="min-w-0 flex-1 py-1">
          <p role="status">
            {hostName} is{" "}
            {resuming
              ? "resuming…"
              : phase === "suspending"
                ? "pausing…"
                : "paused"}
          </p>
          {error && !resuming ? (
            <p
              role="alert"
              className="mt-1 text-subtle-foreground leading-snug break-words"
            >
              {error}
            </p>
          ) : null}
        </div>
        {phase === "suspended" ? (
          <Button
            size="sm"
            variant="ghost"
            className="shrink-0"
            disabled={resuming}
            onClick={onResume}
          >
            {error && !resuming ? "Retry" : "Resume"}
          </Button>
        ) : null}
      </div>
    </PromptStackCard>
  );
}
