import type { WorkspaceContext } from "@kaioken/host-daemon-contract";
import type { ProvisionWorkspaceArgs } from "@kaioken/host-workspace";

interface ReconnectProvisionArgs {
  workspacePath: string;
}

interface WorkspaceContextProvisionArgs {
  workspaceContext: WorkspaceContext;
}

export function reconnectProvisionArgs(
  args: ReconnectProvisionArgs,
): ProvisionWorkspaceArgs {
  return {
    path: args.workspacePath,
  };
}

export function reconnectProvisionArgsFromWorkspaceContext(
  args: WorkspaceContextProvisionArgs,
): ProvisionWorkspaceArgs {
  return reconnectProvisionArgs({
    workspacePath: args.workspaceContext.workspacePath,
  });
}
