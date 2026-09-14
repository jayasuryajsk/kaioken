import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
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
      title="Kaiokens on this account"
      description="Every Kaioken paired to your connect account. Their threads and projects show in the sidebar read-only; actions on them arrive in the next phase."
    >
      {servers.length === 0 ? (
        <p
          data-testid="account-servers-empty"
          className="text-sm text-muted-foreground"
        >
          {serversQuery.isPending
            ? "Checking your connect account…"
            : "Pair this Kaioken with `kaioken connect` to see the others here."}
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
                    <SettingsBadge>This Kaioken</SettingsBadge>
                  ) : null}
                </div>
                <p className="truncate text-xs text-muted-foreground">
                  {server.url} · {accountServerStatusText(server, now)}
                </p>
              </div>
            </SettingsRow>
          ))}
        </SettingsRowList>
      )}
    </SettingsSection>
  );
}
