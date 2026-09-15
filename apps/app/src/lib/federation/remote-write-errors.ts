import type { FederatedServer } from "@kaioken/client-core";
import { appToast } from "@/components/ui/app-toast";
import { KaiokenHttpError } from "@/lib/sdk";

export function describeRemoteWriteFailure(
  serverName: string,
  action: string,
  error: unknown,
): string {
  if (error instanceof KaiokenHttpError) {
    if (error.status === 401) {
      return `${serverName} rejected the ${action}: this device is not signed in there.`;
    }
    if (error.status === 503 || error.status === 0) {
      return `${serverName} is unavailable. Refresh its status before retrying the ${action}.`;
    }
    return `${serverName} could not complete the ${action} (HTTP ${error.status}).`;
  }
  return `${serverName} could not complete the ${action}.`;
}

export function reportRemoteWriteFailure(
  server: FederatedServer,
  action: string,
  error: unknown,
): void {
  appToast.error(describeRemoteWriteFailure(server.name, action, error), {
    description: "Refresh this computer before trying again.",
  });
}
