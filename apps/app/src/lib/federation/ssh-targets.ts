import type { SshConnectionsResponse } from "@kaioken/server-contract";
import { bindConnectionIdentity } from "./connection-identities";

const aliasesByOrigin = new Map<string, string>();

export function updateSshTargets(
  connections: SshConnectionsResponse["connections"],
): void {
  aliasesByOrigin.clear();
  for (const connection of connections) {
    if (connection.url) {
      const origin = new URL(connection.url).origin;
      bindConnectionIdentity(origin, `ssh.${connection.alias}`);
      aliasesByOrigin.set(origin, connection.alias);
    }
  }
}

export function sshAliasForOrigin(origin: string): string | null {
  return aliasesByOrigin.get(origin) ?? null;
}
