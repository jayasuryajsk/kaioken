import type { ServerAccessStatus } from "@bb/server-contract";
import { isLocalOnlyUrl } from "@/lib/loopback-hostname";

export const MACHINE_SERVER_ACCESS_TITLE = "Machines cannot reach this bb yet";

export function machineServerAccessReady(
  access: ServerAccessStatus | undefined,
): boolean {
  if (access === undefined) return false;
  const provider = access.providers.find(
    (candidate) => candidate.id === access.defaultProviderId,
  );
  if (provider?.availability.status !== "available") return false;
  if (access.defaultProviderId !== "direct") return true;
  return access.effectiveUrl !== null && !isLocalOnlyUrl(access.effectiveUrl);
}

export const MACHINE_SERVER_ACCESS_UNSET_REASON =
  "Configure how machines should connect to this bb server.";

export function machineServerAccessBlockedReason(
  access: ServerAccessStatus | undefined,
): string | null {
  if (access === undefined || machineServerAccessReady(access)) return null;
  const provider = access.providers.find(
    (candidate) => candidate.id === access.defaultProviderId,
  );
  if (provider?.availability.status === "unavailable") {
    return provider.availability.message;
  }
  if (provider?.availability.status === "available") {
    return access.effectiveUrl === null
      ? MACHINE_SERVER_ACCESS_UNSET_REASON
      : `Machines cannot reach ${access.effectiveUrl}. Give them an address other than localhost.`;
  }
  return MACHINE_SERVER_ACCESS_UNSET_REASON;
}
