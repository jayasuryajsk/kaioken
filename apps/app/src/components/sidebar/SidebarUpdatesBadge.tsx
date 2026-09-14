import { Link } from "react-router-dom";
import type { ProviderCliKey } from "@kaioken/host-daemon-contract";
import { Icon } from "@kaioken/shared-ui/icon";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@kaioken/shared-ui/tooltip";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { useProviderCliInstallRunner } from "@/components/provider-cli/provider-cli-install";
import { providerCliJobKey } from "@/components/provider-cli/provider-cli-install-store";
import { SidebarMenuItem } from "@/components/ui/sidebar.js";
import { useSystemProviders } from "@/hooks/queries/system-queries";
import { useUpdateInventory } from "@/hooks/useUpdateInventory";
import { ProviderIconMark } from "@/components/settings/ProviderIconMark";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { getBbDesktopInfo } from "@/lib/kaioken-desktop";
import { KaiokenLogo } from "@/components/ui/kaioken-logo";
import { getSettingsRoutePath } from "@/lib/route-paths";
import { appToast } from "@/components/ui/app-toast";
import { checkErrorDescription } from "@/components/settings/app-update-check-store";

interface SidebarUpdatesBadgeProps {
  onNavigate?: () => void;
}

const CHIP_CLASS = cn(
  "flex h-6 shrink-0 items-center gap-1.5 rounded-full border border-sidebar-border px-2",
  "text-xs font-medium text-sidebar-foreground transition-colors hover:bg-sidebar-accent",
);

function joinNames(names: string[]): string {
  if (names.length <= 1) {
    return names[0] ?? "";
  }
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

interface StaleProvider {
  provider: ProviderCliKey;
  displayName: string;
}

export function SidebarUpdatesBadge({ onNavigate }: SidebarUpdatesBadgeProps) {
  const inventory = useUpdateInventory();
  const providers = useSystemProviders().data;
  const { runningJobKey } = useProviderCliInstallRunner();

  const stuckDaemonCount = inventory.machines.filter(
    (machine) => machine.canRetryDaemonUpdate,
  ).length;
  const kaiokenUpdateCount =
    (inventory.appUpdateAvailable ? 1 : 0) +
    (inventory.desktopUpdateReady ? 1 : 0) +
    stuckDaemonCount;
  const restartVersion = inventory.desktopUpdateReady
    ? (inventory.desktopInfo?.pendingVersion ?? null)
    : null;
  const restartLabel = restartVersion
    ? `Restart to update to ${restartVersion}`
    : "Restart to update";
  const restartToUpdate = () => {
    const desktopApi = getBbDesktopInfo();
    if (desktopApi === null) return;
    void desktopApi.installUpdate().catch((error: unknown) => {
      appToast.error("Restart failed", {
        description: checkErrorDescription(error),
      });
    });
  };

  const staleProvidersByKey = new Map<ProviderCliKey, StaleProvider>();
  for (const machine of inventory.machines) {
    for (const issue of machine.issues) {
      if (!issue.status.installed) {
        continue;
      }
      if (!staleProvidersByKey.has(issue.provider)) {
        staleProvidersByKey.set(issue.provider, {
          provider: issue.provider,
          displayName: issue.status.displayName,
        });
      }
    }
  }
  const staleProviders = [...staleProvidersByKey.values()];
  const providerUpdateRunning = inventory.machines.some((machine) =>
    machine.issues.some(
      (issue) =>
        issue.status.installed &&
        runningJobKey === providerCliJobKey(machine.host.id, issue.provider),
    ),
  );

  if (kaiokenUpdateCount === 0 && staleProviders.length === 0) {
    return null;
  }

  const updatesRoutePath = getSettingsRoutePath("updates");
  const kaiokenLabel =
    kaiokenUpdateCount === 1
      ? "kaioken update available"
      : "kaioken updates available";
  const providerLabel = `${joinNames(
    staleProviders.map((stale) => stale.displayName),
  )} ${staleProviders.length === 1 ? "update" : "updates"} available`;

  return (
    <SidebarMenuItem className="flex min-w-0 items-center gap-1">
      {inventory.desktopUpdateReady ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={restartToUpdate}
              aria-label={restartLabel}
              data-testid="sidebar-updates-restart"
              className={CHIP_CLASS}
            >
              <Icon name="RotateCcw" className="size-3 text-muted-foreground" />
              <KaiokenLogo className="size-3 shrink-0" />
            </button>
          </TooltipTrigger>
          <TooltipContent side="top">{restartLabel}</TooltipContent>
        </Tooltip>
      ) : kaiokenUpdateCount > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={updatesRoutePath}
              onClick={onNavigate}
              aria-label={kaiokenLabel}
              data-testid="sidebar-updates-badge-kaioken"
              className={CHIP_CLASS}
            >
              <Icon name="Download" className="size-3 text-muted-foreground" />
              <KaiokenLogo className="size-3 shrink-0" />
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top">{kaiokenLabel}</TooltipContent>
        </Tooltip>
      ) : null}
      {staleProviders.length > 0 ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Link
              to={updatesRoutePath}
              onClick={onNavigate}
              aria-label={providerLabel}
              data-testid="sidebar-updates-badge-providers"
              className={CHIP_CLASS}
            >
              <Icon
                name={providerUpdateRunning ? "Loading" : "Download"}
                className={cn(
                  "size-3 text-muted-foreground",
                  providerUpdateRunning && "animate-spin",
                )}
              />
              <span className="flex items-center gap-1">
                {staleProviders.map((stale) => {
                  const providerId = stale.provider;
                  const provider = providers?.find(
                    (candidate) => candidate.id === providerId,
                  );
                  const iconInfo = getProviderIconInfo(
                    providerId,
                    provider ?? null,
                  );
                  if (iconInfo === undefined) {
                    return null;
                  }
                  return (
                    <span
                      key={stale.provider}
                      data-provider-icon={providerId}
                      aria-hidden
                      className="flex size-3 shrink-0 items-center justify-center"
                    >
                      {provider === undefined ? (
                        <iconInfo.icon className="size-3" />
                      ) : (
                        <ProviderIconMark
                          provider={provider}
                          icon={iconInfo.icon}
                          className="size-3"
                        />
                      )}
                    </span>
                  );
                })}
              </span>
            </Link>
          </TooltipTrigger>
          <TooltipContent side="top">{providerLabel}</TooltipContent>
        </Tooltip>
      ) : null}
    </SidebarMenuItem>
  );
}
