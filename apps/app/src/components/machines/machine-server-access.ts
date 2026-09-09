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

export function machineServerAccessBlockedReason(
  access: ServerAccessStatus | undefined,
): string | null {
  if (access === undefined || machineServerAccessReady(access)) return null;
  const provider = access.providers.find(
    (candidate) => candidate.id === access.defaultProviderId,
  );
  if (provider === undefined) {
    return "No machine access method is installed for the selected setting.";
  }
  if (provider.availability.status !== "available") {
    return provider.availability.message;
  }
  return access.effectiveUrl === null
    ? "Set the address machines should use to reach this server."
    : `Machines cannot reach ${access.effectiveUrl}. Use an address other than localhost.`;
}
