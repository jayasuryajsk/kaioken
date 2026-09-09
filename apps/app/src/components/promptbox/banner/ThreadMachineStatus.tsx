import { useHosts } from "@/hooks/queries/host-queries";
import { useResumeHost } from "@/hooks/mutations/host-mutations";
import { Button } from "@bb/shared-ui/button";
import { Icon } from "@bb/shared-ui/icon";
import { PromptStackCard } from "./PromptStackCard";
import { getMutationErrorMessage } from "@/lib/mutation-errors";

export function ThreadMachineStatus({ hostId }: { hostId: string }) {
  const hosts = useHosts();
  const resume = useResumeHost();
  const host = hosts.data?.find((candidate) => candidate.id === hostId);
  if (!host || host.machineProviderId === null) return null;
  const pausing = host.lifecycle.phase === "suspending";
  const paused = host.lifecycle.phase === "suspended";
  if (!pausing && !paused) return null;
  return (
    <PromptStackCard ariaLabel="Machine status">
      <div
        className="flex min-h-8 items-center gap-2 px-3 py-1.5 text-xs"
        role="status"
      >
        <Icon
          name="Pause"
          className="size-3.5 shrink-0 text-muted-foreground"
        />
        <span className="min-w-0 flex-1">
          {resume.isPending
            ? `Resuming ${host.name}…`
            : pausing
              ? `Pausing ${host.name}…`
              : `${host.name} is paused`}
        </span>
        {paused ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={resume.isPending}
            onClick={() => resume.mutate(hostId)}
          >
            Resume
          </Button>
        ) : null}
      </div>
      {resume.error ? (
        <p role="alert" className="px-3 pb-2 text-xs text-destructive">
          {getMutationErrorMessage({
            error: resume.error,
            fallbackMessage: "Could not resume the machine.",
          })}
        </p>
      ) : null}
    </PromptStackCard>
  );
}
