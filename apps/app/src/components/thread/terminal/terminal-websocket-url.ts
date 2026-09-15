import {
  buildTerminalWebSocketPath,
  type BuildTerminalWebSocketPathArgs,
} from "@kaioken/client-core";
import { buildDevWebSocketUrl } from "@/lib/dev-websocket-url";
import { withWorkspaceIdentity } from "@/lib/federation/workspace-protocol";

type BuildTerminalWebSocketUrlArgs = BuildTerminalWebSocketPathArgs;

function buildWebSocketUrl(path: string): string {
  const devWebSocketUrl = buildDevWebSocketUrl({ path });
  if (devWebSocketUrl !== undefined) {
    return devWebSocketUrl;
  }

  const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${protocol}//${window.location.host}${path}`;
}

export function buildTerminalWebSocketUrl(
  args: BuildTerminalWebSocketUrlArgs,
): string {
  return withWorkspaceIdentity(
    buildWebSocketUrl(buildTerminalWebSocketPath(args)),
  );
}
