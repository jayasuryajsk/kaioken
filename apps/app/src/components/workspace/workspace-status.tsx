import type { ReactNode } from "react";
import { assertNever } from "@kaioken/core-ui";
import type { WorkspaceStatus } from "@kaioken/domain";
import type { WorkspaceResolutionFailure } from "@kaioken/host-daemon-contract";
import { KaiokenHttpError } from "@kaioken/sdk/browser";
import { describeLifecycleError } from "@/lib/lifecycle-errors";

export interface ThreadGitStatusDisplay {
  label:
    | "Unknown"
    | "Up to date"
    | "Clean"
    | "Ahead"
    | "Behind"
    | "Diverged"
    | "Dirty"
    | "Untracked";
  summary: string;
  summaryContent: ReactNode;
}

interface GetGitStatusDisplayOptions {
  error?: unknown;
  mergeBaseBranch?: string;
  showBranchComparison?: boolean;
  workspaceUnavailable?: WorkspaceResolutionFailure;
  workspaceDeleted?: boolean;
}

function formatComparisonSummary(
  status: WorkspaceStatus,
  mergeBaseBranch?: string,
): string | null {
  const aheadCount = status.mergeBase?.aheadCount ?? 0;
  const behindCount = status.mergeBase?.behindCount ?? 0;
  if (aheadCount === 0 && behindCount === 0) {
    return null;
  }

  if (aheadCount > 0 && behindCount > 0) {
    return mergeBaseBranch
      ? `${aheadCount} ahead, ${behindCount} behind relative to ${mergeBaseBranch}`
      : `${aheadCount} ahead, ${behindCount} behind`;
  }

  if (aheadCount > 0) {
    return mergeBaseBranch
      ? `${aheadCount} ahead of ${mergeBaseBranch}`
      : `${aheadCount} ahead`;
  }

  return mergeBaseBranch
    ? `${behindCount} behind ${mergeBaseBranch}`
    : `${behindCount} behind`;
}

function plainDisplay(
  label: ThreadGitStatusDisplay["label"],
  summary: string,
): ThreadGitStatusDisplay {
  return { label, summary, summaryContent: summary };
}

export function getGitStatusDisplay(
  status: WorkspaceStatus | undefined,
  options?: GetGitStatusDisplayOptions,
): ThreadGitStatusDisplay {
  if (!status) {
    const lifecycleErrorDescription =
      options?.error === undefined
        ? null
        : describeLifecycleError({
            error: options.error,
            operation: "load_git_status",
          });
    if (lifecycleErrorDescription) {
      return plainDisplay("Unknown", lifecycleErrorDescription.body);
    }

    if (options?.workspaceUnavailable) {
      if (options.workspaceUnavailable.code === "path_not_found") {
        return plainDisplay("Unknown", "Workspace not found.");
      }
      return plainDisplay("Unknown", options.workspaceUnavailable.message);
    }

    const isPathNotFound =
      options?.error instanceof KaiokenHttpError &&
      options.error.code === "path_not_found";
    if (options?.workspaceDeleted || isPathNotFound) {
      return plainDisplay("Unknown", "Workspace not found.");
    }
    return plainDisplay("Unknown", "Workspace status unavailable.");
  }

  const resolvedMergeBaseBranch =
    options?.mergeBaseBranch ?? status.mergeBase?.mergeBaseBranch;
  const comparisonSummary = options?.showBranchComparison
    ? formatComparisonSummary(status, resolvedMergeBaseBranch)
    : null;

  switch (status.workingTree.state) {
    case "clean": {
      if (
        (status.mergeBase?.aheadCount ?? 0) > 0 &&
        (status.mergeBase?.behindCount ?? 0) > 0
      ) {
        return plainDisplay(
          "Diverged",
          comparisonSummary ?? "Branch has diverged.",
        );
      }
      if ((status.mergeBase?.aheadCount ?? 0) > 0) {
        return plainDisplay(
          "Ahead",
          comparisonSummary ?? "Local commits pending merge.",
        );
      }
      if ((status.mergeBase?.behindCount ?? 0) > 0) {
        return plainDisplay(
          "Behind",
          comparisonSummary ?? "Branch is behind its merge base.",
        );
      }
      return plainDisplay(
        options?.showBranchComparison ? "Up to date" : "Clean",
        resolvedMergeBaseBranch
          ? `No local changes relative to ${resolvedMergeBaseBranch}.`
          : "No local changes.",
      );
    }
    case "untracked":
      return plainDisplay("Untracked", comparisonSummary ?? "");
    case "dirty_uncommitted":
      return plainDisplay("Dirty", comparisonSummary ?? "");
    case "committed_unmerged":
      if (
        (status.mergeBase?.aheadCount ?? 0) > 0 &&
        (status.mergeBase?.behindCount ?? 0) > 0
      ) {
        return plainDisplay(
          "Diverged",
          comparisonSummary ?? "Branch has diverged.",
        );
      }
      if ((status.mergeBase?.behindCount ?? 0) > 0) {
        return plainDisplay(
          "Behind",
          comparisonSummary ?? "Branch is behind its merge base.",
        );
      }
      return plainDisplay(
        "Ahead",
        comparisonSummary ?? "Local commits pending merge.",
      );
    case "dirty_and_committed_unmerged":
      return plainDisplay("Dirty", comparisonSummary ?? "");
    default:
      return assertNever(status.workingTree.state);
  }
}
