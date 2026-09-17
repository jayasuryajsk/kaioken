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
import { useState } from "react";
import { Input } from "@kaioken/shared-ui/input";
import { z } from "zod";
import { sdk } from "@/lib/sdk";

function DeviceActions({
  handle,
  name,
  onChanged,
}: {
  handle: string;
  name: string;
  onChanged: () => void;
}) {
  const [action, setAction] = useState<"rename" | "revoke" | null>(null);
  const [draft, setDraft] = useState(name);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function submit() {
    if (!action) return;
    setBusy(true);
    setError(null);
    try {
      await sdk.plugins.callRpc({
        pluginId: "connect",
        method: action === "rename" ? "renameDevice" : "revokeDevice",
        input:
          action === "rename" ? { handle, name: draft.trim() } : { handle },
        outputSchema: z.object({ ok: z.literal(true) }),
      });
      setAction(null);
      onChanged();
    } catch (error) {
      setError(
        error instanceof Error ? error.message : "Could not update device",
      );
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {action === "rename" ? (
        <>
          <Input
            aria-label={`Name for ${name}`}
            className="w-40"
            maxLength={80}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Button
            size="sm"
            disabled={busy || !draft.trim()}
            onClick={() => void submit()}
          >
            Save
          </Button>
        </>
      ) : action === "revoke" ? (
        <>
          <span className="text-xs text-muted-foreground">Revoke {name}?</span>
          <Button
            size="sm"
            variant="outline"
            className="text-destructive-text"
            disabled={busy}
            onClick={() => void submit()}
          >
            Revoke access
          </Button>
        </>
      ) : (
        <>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Rename ${name}`}
            onClick={() => {
              setDraft(name);
              setError(null);
              setAction("rename");
            }}
          >
            Rename
          </Button>
          <Button
            size="sm"
            variant="ghost"
            aria-label={`Revoke ${name}`}
            onClick={() => {
              setError(null);
              setAction("revoke");
            }}
          >
            Revoke
          </Button>
        </>
      )}
      {action ? (
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => setAction(null)}
        >
          Cancel
        </Button>
      ) : null}
      {error ? (
        <p role="alert" className="w-full text-xs text-destructive-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}

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
                <DeviceActions
                  handle={server.handle}
                  name={server.name}
                  onChanged={() => {
                    void serversQuery.refetch();
                  }}
                />
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
