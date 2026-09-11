import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@kaioken/shared-ui/tooltip";
import {
  formatChangeSummary,
  toChangeTally,
  type WorkspaceChangedFilesSection,
} from "@/components/workspace/workspace-change-summary";

const KIND_LABEL: Record<WorkspaceChangedFilesSection["kind"], string> = {
  uncommitted: "Uncommitted",
  untracked: "Untracked",
  committed: "Committed",
};

interface ThreadChangesChipProps {
  onOpen?: () => void;
  section: WorkspaceChangedFilesSection;
}

export function ThreadChangesChip({ onOpen, section }: ThreadChangesChipProps) {
  const tally = toChangeTally(section.stats);
  if (tally.filesCount === 0) return null;
  const summary = formatChangeSummary(tally);
  const label = `${KIND_LABEL[section.kind]}: ${summary}`;
  const body = (
    <>
      <Icon name="GitBranch" className="size-3.5 shrink-0" />
      <span className="min-w-0 truncate tabular-nums">
        {tally.lineStatsComplete &&
        (tally.insertions > 0 || tally.deletions > 0)
          ? `+${tally.insertions.toLocaleString()} −${tally.deletions.toLocaleString()}`
          : summary}
      </span>
    </>
  );
  const className = cn(
    "inline-flex h-6 min-w-0 shrink items-center gap-1 rounded-md px-1.5 text-xs leading-tight text-muted-foreground",
    onOpen &&
      "cursor-pointer transition-colors hover:bg-state-hover hover:text-foreground",
  );
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        {onOpen ? (
          <button
            type="button"
            data-testid="thread-changes-chip"
            aria-label={`${label}. Open changes`}
            onClick={onOpen}
            className={className}
          >
            {body}
          </button>
        ) : (
          <span
            data-testid="thread-changes-chip"
            aria-label={label}
            className={className}
          >
            {body}
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent>{label}</TooltipContent>
    </Tooltip>
  );
}
