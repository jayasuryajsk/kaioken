import { useId, useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@kaioken/shared-ui/button";
import { Input } from "@kaioken/shared-ui/input";
import {
  SettingsSection,
  SettingsRow,
  SettingsRowList,
} from "@/components/ui/settings-section";
import {
  canControlLocalSsh,
  useSshConnectionActions,
  useSshConnections,
} from "@/hooks/queries/connection-queries";

export function SshConnectionsSettingsSection() {
  const query = useSshConnections();
  const actions = useSshConnectionActions();
  const [alias, setAlias] = useState("");
  const listId = useId();
  return (
    <SettingsSection
      title="SSH connections"
      description="Use a host from your OpenSSH configuration. Kaioken checks the remote runtime and starts it when needed; the connection uses a private SSH tunnel."
    >
      {canControlLocalSsh ? (
        <>
          <form
            className="flex gap-2"
            onSubmit={(event) => {
              event.preventDefault();
              if (alias.trim()) actions.connect.mutate(alias.trim());
            }}
          >
            <Input
              aria-label="SSH host"
              list={listId}
              value={alias}
              onChange={(event) => setAlias(event.target.value)}
              placeholder="Choose or enter an SSH host"
            />
            <datalist id={listId}>
              {query.data?.aliases.map((host) => (
                <option key={host} value={host} />
              ))}
            </datalist>
            <Button
              type="submit"
              variant="outline"
              disabled={!alias.trim() || actions.connect.isPending}
            >
              Connect
            </Button>
          </form>
          {query.isError ? (
            <p className="text-sm text-muted-foreground" role="alert">
              SSH discovery is unavailable. Check that this computer's host
              daemon is up to date and connected.
            </p>
          ) : null}
          {actions.connect.error ? (
            <p role="alert" className="text-sm text-destructive">
              {actions.connect.error.message}
            </p>
          ) : null}
          {actions.disconnect.error ? (
            <p role="alert" className="text-sm text-destructive">
              {actions.disconnect.error.message}
            </p>
          ) : null}
          <SettingsRowList>
            {query.data?.connections.map((connection) => (
              <SettingsRow key={connection.alias}>
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">
                    {connection.alias}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {connection.state === "ready"
                      ? "Connected"
                      : connection.state}
                    {connection.error ? ` · ${connection.error}` : ""}
                  </p>
                </div>
                {connection.state === "ready" ? (
                  <Button size="sm" variant="outline" asChild>
                    <Link to="/">View projects</Link>
                  </Button>
                ) : (
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={
                      actions.connect.isPending ||
                      connection.state === "connecting" ||
                      connection.state === "reconnecting"
                    }
                    onClick={() => actions.connect.mutate(connection.alias)}
                  >
                    Retry
                  </Button>
                )}
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={actions.disconnect.isPending}
                  onClick={() => actions.disconnect.mutate(connection.alias)}
                >
                  Disconnect
                </Button>
              </SettingsRow>
            ))}
          </SettingsRowList>
          <p className="text-xs text-muted-foreground">
            Use your existing SSH keys and host trust. If sign-in or a host key
            needs attention, run ssh for that host in your terminal and retry.
            The remote login shell needs kaioken-app installed.
          </p>
        </>
      ) : (
        <p className="text-sm text-muted-foreground">
          Open Kaioken on the computer whose SSH configuration you want to use.
        </p>
      )}
    </SettingsSection>
  );
}
