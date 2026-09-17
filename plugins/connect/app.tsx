import { useCallback, useEffect, useRef, useState } from "react";
import {
  definePluginApp,
  UrlLink as UrlLink,
  useRealtime,
  useRpc,
  useBbNavigate,
} from "@get-kaioken/plugin-sdk/app";
import {
  connectLoginStatusSchema,
  CONNECT_LOGIN_CHANNEL,
  type ConnectLoginStatus,
} from "@kaioken/connect-client";
import type { connectRpcContract } from "./src/rpc.js";
import { Button } from "@kaioken/shared-ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@kaioken/shared-ui/dialog";
import { Icon } from "@kaioken/shared-ui/icon";
import { Input } from "@kaioken/shared-ui/input";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { CONNECT_REALTIME_CHANNEL, type ConnectStatus } from "@/src/types";

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const DANGER_QUIET_CLASS =
  "text-destructive-text hover:text-destructive-text hover:bg-surface-destructive";

function asStatus(payload: unknown): ConnectStatus | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as {
    state?: unknown;
    paired?: unknown;
    handle?: unknown;
    url?: unknown;
    dashboardUrl?: unknown;
    lastError?: unknown;
    nextRetryAt?: unknown;
    since?: unknown;
    remoteClients?: unknown;
    lastRemoteActivityAt?: unknown;
    shares?: unknown;
  };
  if (
    (record.state !== "disconnected" &&
      record.state !== "pairing" &&
      record.state !== "connected" &&
      record.state !== "reconnecting") ||
    typeof record.paired !== "boolean" ||
    typeof record.since !== "number"
  ) {
    return null;
  }
  const shares: ConnectStatus["shares"] = [];
  if (Array.isArray(record.shares)) {
    for (const entry of record.shares) {
      if (
        entry !== null &&
        typeof entry === "object" &&
        typeof (entry as { hostId?: unknown }).hostId === "string" &&
        typeof (entry as { hostName?: unknown }).hostName === "string" &&
        typeof (entry as { port?: unknown }).port === "number" &&
        typeof (entry as { createdAt?: unknown }).createdAt === "number" &&
        typeof (entry as { url?: unknown }).url === "string"
      ) {
        shares.push({
          hostId: (entry as { hostId: string }).hostId,
          hostName: (entry as { hostName: string }).hostName,
          port: (entry as { port: number }).port,
          createdAt: (entry as { createdAt: number }).createdAt,
          url: (entry as { url: string }).url,
          ...(typeof (entry as { unavailableReason?: unknown })
            .unavailableReason === "string"
            ? {
                unavailableReason: (entry as { unavailableReason: string })
                  .unavailableReason,
              }
            : {}),
        });
      }
    }
  }
  return {
    state: record.state,
    paired: record.paired,
    handle: typeof record.handle === "string" ? record.handle : null,
    url: typeof record.url === "string" ? record.url : null,
    dashboardUrl:
      typeof record.dashboardUrl === "string"
        ? record.dashboardUrl
        : "https://kaioken.app/dashboard",
    lastError: typeof record.lastError === "string" ? record.lastError : null,
    nextRetryAt:
      typeof record.nextRetryAt === "number" ? record.nextRetryAt : null,
    since: record.since,
    remoteClients:
      typeof record.remoteClients === "number" ? record.remoteClients : 0,
    lastRemoteActivityAt:
      typeof record.lastRemoteActivityAt === "number"
        ? record.lastRemoteActivityAt
        : null,
    shares,
  };
}

function formatSince(sinceMs: number): string {
  const at = new Date(sinceMs);
  const now = new Date();
  const sameDay =
    at.getFullYear() === now.getFullYear() &&
    at.getMonth() === now.getMonth() &&
    at.getDate() === now.getDate();
  return sameDay
    ? at.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })
    : at.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function retryHint(nextRetryAt: number | null): string {
  if (nextRetryAt === null) return "retrying automatically";
  const seconds = Math.max(0, Math.round((nextRetryAt - Date.now()) / 1000));
  return seconds > 0 ? `retrying in ${seconds}s` : "retrying…";
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url.replace(/^https?:\/\//, "");
  }
}

const CONNECT_CODE_MAX_LENGTH = 12;

function StatusDot({ tone }: { tone: "ok" | "warn" | "muted" }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        tone === "ok" &&
          "bg-success shadow-[0_0_0_3px_color-mix(in_oklab,var(--success)_18%,transparent)]",
        tone === "warn" &&
          "animate-pulse bg-warning shadow-[0_0_0_3px_color-mix(in_oklab,var(--warning)_22%,transparent)]",
        tone === "muted" && "bg-muted-foreground/50",
      )}
    />
  );
}

function UrlHero({ url, showOpen }: { url: string; showOpen: boolean }) {
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">(
    "idle",
  );
  const urlRef = useRef<HTMLSpanElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  const selectUrl = useCallback(() => {
    const element = urlRef.current;
    if (element === null) return;
    const selection = window.getSelection();
    if (selection === null) return;
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
  }, []);

  const copy = useCallback(() => {
    navigator.clipboard.writeText(url).then(
      () => {
        setCopyState("copied");
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopyState("idle"), 1500);
      },
      () => {
        selectUrl();
        setCopyState("manual");
      },
    );
  }, [url, selectUrl]);

  return (
    <div className="flex max-w-xl items-center gap-1 rounded-lg border border-border bg-surface-recessed py-1 pl-3.5 pr-1">
      <UrlLink
        href={url}
        target="_blank"
        rel="noreferrer"
        className="min-w-0 flex-1 truncate font-mono text-sm font-medium text-foreground no-underline hover:underline"
      >
        <span ref={urlRef}>{url}</span>
      </UrlLink>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={copy}
        aria-label="Copy URL"
      >
        <Icon
          name={copyState === "copied" ? "Check" : "Copy"}
          className="size-4"
        />
        {copyState === "copied"
          ? "Copied"
          : copyState === "manual"
            ? "Press ⌘C"
            : "Copy"}
      </Button>
      {showOpen ? (
        <Button type="button" variant="outline" size="sm" asChild>
          <UrlLink href={url} target="_blank" rel="noreferrer">
            Open
          </UrlLink>
        </Button>
      ) : null}
    </div>
  );
}

function QuietCopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );
  const copy = useCallback(() => {
    navigator.clipboard.writeText(text).then(
      () => {
        setCopied(true);
        if (timerRef.current !== null) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }, [text]);
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-muted-foreground"
      onClick={copy}
      aria-label={label}
    >
      {copied ? "Copied" : "Copy"}
    </Button>
  );
}

interface ShareHostGroup {
  hostId: string;
  hostName: string;
  shares: ConnectStatus["shares"];
}

function groupSharesByHost(shares: ConnectStatus["shares"]): ShareHostGroup[] {
  const groups: ShareHostGroup[] = [];
  const byHostId = new Map<string, ShareHostGroup>();
  for (const share of shares) {
    let group = byHostId.get(share.hostId);
    if (group === undefined) {
      group = { hostId: share.hostId, hostName: share.hostName, shares: [] };
      byHostId.set(share.hostId, group);
      groups.push(group);
    }
    group.shares.push(share);
  }
  return groups;
}

function SharedPortsSection({
  shares,
  dimmed,
}: {
  shares: ConnectStatus["shares"];
  dimmed: boolean;
}) {
  const rpc = useRpc<typeof connectRpcContract>();
  const [portInput, setPortInput] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [exposing, setExposing] = useState(false);
  const [revokingShare, setRevokingShare] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const expose = useCallback(() => {
    const trimmed = portInput.trim();
    if (trimmed.length === 0 || exposing) return;
    const port = Number(trimmed);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      setError("Port must be an integer between 1 and 65535");
      return;
    }
    setExposing(true);
    setError(null);
    rpc.call("expose", { port }).then(
      () => {
        setExposing(false);
        setPortInput("");
        setFormOpen(false);
      },
      (rpcError: unknown) => {
        setExposing(false);
        setError(errorText(rpcError));
      },
    );
  }, [portInput, exposing, rpc]);

  const unexpose = useCallback(
    (hostId: string, port: number) => {
      if (revokingShare !== null) return;
      const key = `${hostId}:${port}`;
      setRevokingShare(key);
      setError(null);
      rpc.call("unexpose", { hostId, port }).then(
        () => {
          setRevokingShare(null);
        },
        (rpcError: unknown) => {
          setRevokingShare(null);
          setError(errorText(rpcError));
        },
      );
    },
    [revokingShare, rpc],
  );

  return (
    <div
      className={cn(
        "space-y-2.5 border-t border-border-seam pt-4",
        dimmed && "pointer-events-none opacity-60 saturate-[0.85]",
      )}
    >
      <div className="flex items-center">
        <h3 className="text-[11px] font-semibold uppercase tracking-wide text-subtle-foreground">
          Shared ports
        </h3>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="text-muted-foreground"
          onClick={() => setFormOpen((open) => !open)}
        >
          <Icon name="Plus" className="size-3.5" />
          Expose a port
        </Button>
      </div>

      {shares.length > 0 ? (
        <div className="space-y-2.5">
          {groupSharesByHost(shares).map((group) => {
            const hostDown = group.shares.every((share) => share.url === "");
            return (
              <div key={group.hostId} className="space-y-1">
                <div className="flex items-center gap-1.5">
                  <StatusDot tone={hostDown ? "muted" : "ok"} />
                  <span
                    className={cn(
                      "min-w-0 truncate text-xs font-medium",
                      hostDown ? "text-muted-foreground" : "text-foreground",
                    )}
                  >
                    {group.hostName}
                  </span>
                </div>
                <ul className="space-y-1 pl-3.5">
                  {group.shares.map((share) => (
                    <li
                      key={`${share.hostId}:${share.port}`}
                      className="flex items-center gap-2"
                    >
                      <span
                        className={cn(
                          "shrink-0 font-mono text-xs tabular-nums",
                          share.url
                            ? "text-foreground"
                            : "text-muted-foreground",
                        )}
                      >
                        :{share.port}
                      </span>
                      {share.url ? (
                        <>
                          <UrlLink
                            href={share.url}
                            target="_blank"
                            rel="noreferrer"
                            className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground underline-offset-2 hover:underline"
                          >
                            {hostOf(share.url)}
                          </UrlLink>
                          <QuietCopyButton
                            text={share.url}
                            label={`Copy share URL for port ${share.port}`}
                          />
                        </>
                      ) : (
                        <span
                          className="min-w-0 flex-1 truncate text-xs text-muted-foreground"
                          title={share.unavailableReason}
                        >
                          Unavailable —{" "}
                          {share.unavailableReason ?? "unknown reason"}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className={DANGER_QUIET_CLASS}
                        disabled={
                          revokingShare === `${share.hostId}:${share.port}`
                        }
                        onClick={() => unexpose(share.hostId, share.port)}
                      >
                        {revokingShare === `${share.hostId}:${share.port}` ? (
                          <Icon
                            name="Spinner"
                            className="size-4 animate-spin"
                          />
                        ) : null}
                        Revoke
                      </Button>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      ) : null}

      {formOpen ? (
        <form
          className="flex max-w-[16rem] items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            expose();
          }}
        >
          <Input
            type="number"
            min={1}
            max={65535}
            step={1}
            value={portInput}
            onChange={(event) => setPortInput(event.target.value)}
            placeholder="Port"
            inputMode="numeric"
            className="max-w-[7rem] font-mono"
            aria-label="Port to share"
          />
          <Button
            type="submit"
            size="sm"
            disabled={exposing || portInput.trim().length === 0}
          >
            {exposing ? (
              <Icon name="Spinner" className="size-4 animate-spin" />
            ) : null}
            Expose
          </Button>
        </form>
      ) : null}

      <p className="text-xs text-subtle-foreground/75">
        Agents can expose their dev servers too — same owner sign-in required to
        view.
      </p>
      {error !== null ? (
        <p className="text-xs text-destructive-text">{error}</p>
      ) : null}
    </div>
  );
}

function DisconnectDialog({
  open,
  onOpenChange,
  host,
  pending,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  host: string;
  pending: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        {open ? (
          <>
            <DialogHeader>
              <DialogTitle>Sign out of this computer?</DialogTitle>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{host}</span> will
              stop being available on your other computers. Sign in with GitHub
              to reconnect.
            </p>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                disabled={pending}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                variant="destructive"
                disabled={pending}
                onClick={onConfirm}
              >
                {pending ? (
                  <Icon name="Spinner" className="size-4 animate-spin" />
                ) : null}
                {pending ? "Signing out…" : "Sign out"}
              </Button>
            </DialogFooter>
          </>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function ConnectedContent({
  status,
  onChanged,
  onDisconnected,
}: {
  status: ConnectStatus;
  onChanged: () => void;
  onDisconnected: () => void;
}) {
  const rpc = useRpc<typeof connectRpcContract>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    setDisconnecting(true);
    setDisconnectError(null);
    (async () => {
      if (status.handle)
        await rpc.call("revokeDevice", { handle: status.handle });
      return rpc.call("disconnect");
    })().then(
      () => {
        setDisconnecting(false);
        setConfirmOpen(false);
        onDisconnected();
        onChanged();
      },
      (error: unknown) => {
        setDisconnecting(false);
        setDisconnectError(errorText(error));
      },
    );
  }, [rpc, status.handle, onChanged, onDisconnected]);

  const host = status.url !== null ? hostOf(status.url) : "this kaioken";

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusDot tone="ok" />
        <span className="text-sm font-semibold">Connected</span>
        <span className="min-w-0 truncate text-xs text-muted-foreground">
          since {formatSince(status.since)}
          {status.remoteClients > 0
            ? ` · ${status.remoteClients} viewing remotely`
            : ""}
        </span>
      </div>

      {status.url !== null ? <UrlHero url={status.url} showOpen /> : null}

      <SharedPortsSection shares={status.shares} dimmed={false} />

      <div className="-mx-4 mt-4 flex items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Sign out to remove this computer from your account.
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={DANGER_QUIET_CLASS}
          onClick={() => setConfirmOpen(true)}
        >
          Sign out
        </Button>
      </div>
      {disconnectError !== null ? (
        <p className="text-xs text-destructive-text">{disconnectError}</p>
      ) : null}

      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        host={host}
        pending={disconnecting}
        onConfirm={disconnect}
      />
    </div>
  );
}

function ReconnectingContent({
  status,
  onChanged,
  onDisconnected,
}: {
  status: ConnectStatus;
  onChanged: () => void;
  onDisconnected: () => void;
}) {
  const rpc = useRpc<typeof connectRpcContract>();
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [disconnectError, setDisconnectError] = useState<string | null>(null);

  const disconnect = useCallback(() => {
    setDisconnecting(true);
    setDisconnectError(null);
    (async () => {
      if (status.handle)
        await rpc.call("revokeDevice", { handle: status.handle });
      return rpc.call("disconnect");
    })().then(
      () => {
        setDisconnecting(false);
        setConfirmOpen(false);
        onDisconnected();
        onChanged();
      },
      (error: unknown) => {
        setDisconnecting(false);
        setDisconnectError(errorText(error));
      },
    );
  }, [rpc, status.handle, onChanged, onDisconnected]);

  const host = status.url !== null ? hostOf(status.url) : "this kaioken";
  const why = [status.lastError, retryHint(status.nextRetryAt)]
    .filter((part): part is string => part !== null && part.length > 0)
    .join(" · ");

  return (
    <div className="space-y-4">
      {}
      <div className="-mx-4 -mt-3.5 flex items-center gap-2.5 rounded-t-lg border-b border-warning/40 bg-warning/10 px-4 py-3">
        <StatusDot tone="warn" />
        <span className="shrink-0 text-sm font-semibold text-warning-text">
          Reconnecting…
        </span>
        <span className="min-w-0 truncate text-xs text-warning-text/80">
          {why}
        </span>
      </div>

      <div className="space-y-2 pointer-events-none opacity-60 saturate-[0.85]">
        <p className="text-sm text-muted-foreground">
          Your kaioken will be reachable again at:
        </p>
        {status.url !== null ? (
          <UrlHero url={status.url} showOpen={false} />
        ) : null}
      </div>

      <SharedPortsSection shares={status.shares} dimmed />

      <div className="-mx-4 mt-4 flex items-center gap-3 border-t border-border-seam px-4 pt-3">
        <span className="min-w-0 text-xs text-muted-foreground">
          Remote devices can&apos;t reach this kaioken right now. Local access
          is unaffected.
        </span>
        <span className="flex-1" />
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={DANGER_QUIET_CLASS}
          onClick={() => setConfirmOpen(true)}
        >
          Sign out
        </Button>
      </div>
      {disconnectError !== null ? (
        <p className="text-xs text-destructive-text">{disconnectError}</p>
      ) : null}

      <DisconnectDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        host={host}
        pending={disconnecting}
        onConfirm={disconnect}
      />
    </div>
  );
}

function GitHubSignIn({
  paired,
  onChanged,
}: {
  paired: boolean;
  onChanged: () => void;
}) {
  const rpc = useRpc<typeof connectRpcContract>();
  const navigate = useBbNavigate();
  const [login, setLogin] = useState<ConnectLoginStatus | null>(null);
  const revision = useRef(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    const requestRevision = revision.current;
    rpc.call("signInStatus").then(
      (result) => {
        if (active && revision.current === requestRevision) setLogin(result);
      },
      () => {},
    );
    return () => {
      active = false;
    };
  }, [rpc, paired]);
  useRealtime(CONNECT_LOGIN_CHANNEL, (payload) => {
    const parsed = connectLoginStatusSchema.safeParse(payload);
    if (!parsed.success) return;
    revision.current += 1;
    setLogin(parsed.data);
    if (parsed.data.state === "signed-in") onChanged();
  });
  const begin = async () => {
    setBusy(true);
    setError(null);
    try {
      revision.current += 1;
      const result = await rpc.call("beginSignIn", {});
      setLogin(result);
      if (result.browserUrl) navigate.openUrl(result.browserUrl);
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  const cancel = async () => {
    setBusy(true);
    revision.current += 1;
    try {
      setLogin(await rpc.call("cancelSignIn"));
    } catch (error) {
      setError(errorText(error));
    } finally {
      setBusy(false);
    }
  };
  if (login?.state === "signed-in" && login.account)
    return (
      <p className="text-sm text-muted-foreground">
        Signed in as{" "}
        <span className="font-medium text-foreground">
          {login.account.login}
        </span>{" "}
        · GitHub
      </p>
    );
  return (
    <div className="space-y-3">
      <div>
        <p className="text-sm font-medium">Your computers, connected</p>
        <p className="text-sm text-muted-foreground">
          Sign in with the same GitHub account on each computer. Your projects
          and tasks stay on the computer where they run.
        </p>
      </div>
      {login?.state === "waiting" && login.browserUrl ? (
        <div className="space-y-2">
          <p role="status" className="text-sm text-muted-foreground">
            Finish signing in in your browser. This computer will connect
            automatically.
          </p>
          <div className="flex gap-2">
            <Button asChild>
              <UrlLink href={login.browserUrl} target="_blank" rel="noreferrer">
                Open sign-in
              </UrlLink>
            </Button>
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => void cancel()}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <Button disabled={busy} onClick={() => void begin()}>
          {busy ? "Starting sign-in…" : "Continue with GitHub"}
        </Button>
      )}
      {error || login?.error ? (
        <p role="alert" className="text-sm text-destructive-text">
          {error ?? login?.error}
        </p>
      ) : null}
    </div>
  );
}

function ConnectSettingsSection() {
  const rpc = useRpc<typeof connectRpcContract>();
  const [status, setStatus] = useState<ConnectStatus | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refetch = useCallback(() => {
    rpc.call("status").then(
      (result) => {
        const next = asStatus(result);
        if (next !== null) {
          setStatus(next);
          setLoadError(null);
        } else {
          setLoadError("Unexpected status payload.");
        }
      },
      (error: unknown) => setLoadError(errorText(error)),
    );
  }, [rpc]);

  useEffect(() => {
    refetch();
  }, [refetch]);

  useRealtime(CONNECT_REALTIME_CHANNEL, (payload) => {
    const next = asStatus(payload);
    if (next !== null) {
      setStatus(next);
      setLoadError(null);
    }
  });

  const showDisconnected = useCallback(() => {
    setFlash("Signed out of this computer");
    if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setFlash(null), 4000);
  }, []);

  useEffect(
    () => () => {
      if (flashTimerRef.current !== null) clearTimeout(flashTimerRef.current);
    },
    [],
  );

  if (loadError !== null) {
    return (
      <p className="text-sm text-destructive-text">
        Failed to load remote-access status: {loadError}
      </p>
    );
  }
  if (status === null) {
    return <p className="text-sm text-muted-foreground">Loading...</p>;
  }

  return (
    <div className="space-y-3">
      <GitHubSignIn paired={status.paired} onChanged={refetch} />
      {flash !== null && !status.paired ? (
        <div
          role="status"
          className="flex items-center gap-2 rounded-md border border-border bg-surface-recessed px-3 py-2 text-xs text-foreground"
        >
          <Icon name="Check" className="size-3.5 text-success" />
          {flash}
        </div>
      ) : null}
      {!status.paired ? null : status.state === "reconnecting" ? (
        <ReconnectingContent
          status={status}
          onChanged={refetch}
          onDisconnected={showDisconnected}
        />
      ) : (
        <ConnectedContent
          status={status}
          onChanged={refetch}
          onDisconnected={showDisconnected}
        />
      )}
    </div>
  );
}

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "remote-access",
    description:
      "Use this kaioken from any device, anywhere — powered by kaioken.app.",
    component: ConnectSettingsSection,
  });
  app.experimental_sidebarFooter.register({
    kind: "action",
    id: "remote-access",
    label: "Remote access",
    icon: "Smartphone",
    onActivate({ openPluginDetails }) {
      openPluginDetails();
    },
  });
});
