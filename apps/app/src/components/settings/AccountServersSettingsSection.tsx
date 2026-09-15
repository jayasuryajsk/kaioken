import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { Link } from "react-router-dom";
import { Button } from "@kaioken/shared-ui/button";
import { getRemoteWorkspaceRoutePath } from "@/lib/route-paths";
import { useNow } from "@/components/sidebar/TimelineThreadList";
import {
  SettingsBadge,
  SettingsRow,
  SettingsRowList,
  SettingsSection,
} from "@/components/ui/settings-section";
import { useAccountServers } from "@/hooks/queries/federation-queries";
import { formatRelativeTime } from "@/lib/relative-time";

export function accountServerStatusText(
  server: { live: boolean; lastSeenAt: number | null },
  now: number,
): string {
  if (server.live) return "Live";
  return server.lastSeenAt === null
    ? "Offline"
    : `Offline · last seen ${formatRelativeTime({ timestamp: server.lastSeenAt, now })}`;
}

export function AccountServersSettingsSection() {
  const serversQuery = useAccountServers();
  const now = useNow();
  const servers = serversQuery.data ?? [];
  return (
    <SettingsSection
      title="Connect to another computer"
      description="Open the full workspace of another Kaioken on your account, including its existing projects, tasks and tools."
    >
      {servers.length === 0 ? (
        <p
          data-testid="account-servers-empty"
          className="text-sm text-muted-foreground"
        >
          {serversQuery.isPending
            ? "Checking your connect account…"
            : "Set up remote access on both computers with the same account to see them here."}
        </p>
      ) : (
        <SettingsRowList>
          {servers.map((server) => (
            <SettingsRow
              key={server.handle}
              data-testid="account-server-row"
              data-handle={server.handle}
            >
              <MachineStatusDot connected={server.live} />
              <div className="min-w-0 flex-1">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate font-medium text-foreground">
                    {server.name}
                  </span>
                  <SettingsBadge>{server.handle}</SettingsBadge>
                  {server.home ? (
                    <SettingsBadge>This computer</SettingsBadge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {server.url} · {accountServerStatusText(server, now)}
                </p>
              </div>
              {!server.home ? (
                <Button variant="outline" size="sm" asChild>
                  <Link to={getRemoteWorkspaceRoutePath(server.handle)}>
                    Connect
                  </Link>
                </Button>
              ) : null}
            </SettingsRow>
          ))}
        </SettingsRowList>
      )}
    </SettingsSection>
  );
}
