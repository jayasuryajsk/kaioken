import { workspaceHostMessageSchema } from "@/lib/federation/workspace-messages";
import { useEffect, useRef, useState } from "react";
import { matchPath, useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import type { FederatedServer } from "@kaioken/client-core";
import {
  getRemoteWorkspaceRoutePath,
  getThreadRoutePath,
} from "@/lib/route-paths";
import { Button } from "@kaioken/shared-ui/button";
import {
  useAccountServers,
  useConnectedComputers,
} from "@/hooks/queries/federation-queries";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";
import { KaiokenHttpError } from "@/lib/sdk";
import {
  acknowledgeWorkspaceDraft,
  pendingWorkspaceDraft,
} from "@/lib/federation/workspace-drafts";
import {
  readConnectionIdentity,
  rememberConnectionIdentity,
} from "@/lib/federation/connection-identities";
import {
  CONNECTION_CONTROLLER_PARAM,
  CONNECTION_NONCE_PARAM,
  CONNECTION_IDENTITY_PARAM,
  localWorkspacePath,
  workspaceEmbedding,
  workspaceFrameName,
} from "@/lib/federation/workspace-protocol";

interface WorkspaceEntry {
  server: FederatedServer;
  path: string;
  navigationId: string;
}

type WorkspaceState =
  | "connecting"
  | "ready"
  | "reconnecting"
  | "sign-in-required"
  | "update-required"
  | "offline"
  | "identity-changed";

function stateFromError(error: Error | null): WorkspaceState {
  if (error instanceof KaiokenHttpError) {
    if (error.status === 401 || error.status === 403) return "sign-in-required";
    if (error.status === 404) return "update-required";
  }
  return "offline";
}

const STATE_LABELS: Record<WorkspaceState, string> = {
  connecting: "Connecting…",
  ready: "Connected",
  reconnecting: "Reconnecting…",
  "sign-in-required": "Sign-in required",
  "update-required": "Update required on this computer",
  offline: "Offline",
  "identity-changed": "Computer identity changed",
};

function ConnectedWorkspace({
  entry,
  active,
}: {
  entry: WorkspaceEntry;
  active: boolean;
}) {
  const navigate = useNavigate();
  const frame = useRef<HTMLIFrameElement>(null);
  const [nonce] = useState(() => crypto.randomUUID());
  const [initialPath] = useState(entry.path);
  const [frameVersion, setFrameVersion] = useState(0);
  const [state, setState] = useState<WorkspaceState>("connecting");
  const [ready, setReady] = useState(false);
  const currentEntry = useRef(entry);
  currentEntry.current = entry;
  const activeRef = useRef(active);
  activeRef.current = active;
  const origin = new URL(entry.server.url).origin;
  const [pinnedIdentity, setPinnedIdentity] = useState(() =>
    readConnectionIdentity(origin, entry.server.handle),
  );
  const identity = useQuery({
    queryKey: ["connection", origin, "identity"],
    queryFn: ({ signal }) =>
      getRemoteSdk(origin).experimental_connections.self({ signal }),
    retry: false,
    refetchInterval: 30_000,
    staleTime: 30_000,
  });
  const identityChanged =
    pinnedIdentity !== null &&
    identity.data !== undefined &&
    pinnedIdentity !== identity.data.serverId;
  const displayState = identityChanged ? "identity-changed" : state;
  useEffect(() => {
    if (identity.data && pinnedIdentity === null) {
      rememberConnectionIdentity(
        origin,
        identity.data.serverId,
        entry.server.handle,
      );
      setPinnedIdentity(identity.data.serverId);
    }
  }, [entry.server.handle, identity.data, origin, pinnedIdentity]);
  const iframeUrl = new URL(initialPath, origin);
  iframeUrl.searchParams.set(
    CONNECTION_CONTROLLER_PARAM,
    window.location.origin,
  );
  iframeUrl.searchParams.set(CONNECTION_NONCE_PARAM, nonce);
  if (identity.data)
    iframeUrl.searchParams.set(
      CONNECTION_IDENTITY_PARAM,
      identity.data.serverId,
    );

  useEffect(() => {
    if (identity.isError) setState(stateFromError(identity.error));
  }, [identity.error, identity.isError]);

  useEffect(() => {
    if (!identity.data || ready) return;
    const timeout = window.setTimeout(
      () => setState("update-required"),
      30_000,
    );
    return () => window.clearTimeout(timeout);
  }, [identity.data, ready, frameVersion]);

  useEffect(() => {
    const listener = (event: MessageEvent) => {
      if (
        event.origin !== origin ||
        event.source !== frame.current?.contentWindow
      )
        return;
      const parsed = workspaceHostMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.nonce !== nonce) return;
      const message = parsed.data;
      if (message.type === "kaioken:workspace-ready") {
        if (message.serverId !== identity.data?.serverId) {
          setState("update-required");
          return;
        }
        setReady(true);
        setState("ready");
        const desired = currentEntry.current;
        frame.current?.contentWindow?.postMessage(
          {
            type: "kaioken:workspace-navigate",
            nonce,
            navigationId: desired.navigationId,
            path: desired.path,
            draft: pendingWorkspaceDraft(
              desired.server.handle,
              message.serverId,
              desired.path,
            ),
          },
          origin,
        );
      } else if (message.type === "kaioken:workspace-handoff") {
        if (
          activeRef.current &&
          message.navigationId === currentEntry.current.navigationId
        )
          requestConnectionHandoff({
            handle: currentEntry.current.server.handle,
            threadId: message.threadId,
          });
      } else if (message.type === "kaioken:workspace-draft-accepted") {
        if (identity.data)
          acknowledgeWorkspaceDraft(
            currentEntry.current.server.handle,
            identity.data.serverId,
            message.draftId,
          );
      } else if (message.type === "kaioken:workspace-state") {
        setState(message.state === "connected" ? "ready" : message.state);
      } else if (
        activeRef.current &&
        message.navigationId === currentEntry.current.navigationId
      ) {
        const path = localWorkspacePath(message.path);
        if (path !== null && path !== currentEntry.current.path)
          navigate(
            getRemoteWorkspaceRoutePath(
              currentEntry.current.server.handle,
              path,
            ),
          );
      }
    };
    window.addEventListener("message", listener);
    return () => window.removeEventListener("message", listener);
  }, [identity.data, navigate, nonce, origin]);

  useEffect(() => {
    if (!ready || !active || !identity.data) return;
    frame.current?.contentWindow?.postMessage(
      {
        type: "kaioken:workspace-navigate",
        nonce,
        navigationId: entry.navigationId,
        path: entry.path,
        draft: pendingWorkspaceDraft(
          entry.server.handle,
          identity.data.serverId,
          entry.path,
        ),
      },
      origin,
    );
  }, [
    active,
    entry.navigationId,
    entry.path,
    entry.server.handle,
    identity.data,
    nonce,
    origin,
    ready,
  ]);

  const retry = () => {
    if (identityChanged && identity.data) {
      rememberConnectionIdentity(
        origin,
        identity.data.serverId,
        entry.server.handle,
      );
      setPinnedIdentity(identity.data.serverId);
      setReady(false);
      setState("connecting");
      setFrameVersion((value) => value + 1);
      return;
    }
    setState(ready ? "reconnecting" : "connecting");
    void identity.refetch().then((result) => {
      if (!ready && result.isSuccess) setFrameVersion((value) => value + 1);
    });
  };

  return (
    <section
      hidden={!active}
      className={active ? "absolute inset-0 flex min-h-0 flex-col" : "hidden"}
      aria-label={`Workspace on ${entry.server.name}`}
    >
      <div
        className="flex min-h-10 items-center gap-2 border-b border-border px-3 text-xs text-muted-foreground"
        role="status"
      >
        <span className="truncate font-medium text-foreground">
          On {entry.server.name}
        </span>
        <span className="truncate">{STATE_LABELS[displayState]}</span>
        {identityChanged ? (
          <Button variant="outline" size="sm" onClick={retry}>
            Connect again
          </Button>
        ) : null}
        {!identityChanged && state !== "ready" && state !== "connecting" ? (
          <Button variant="ghost" size="sm" className="ml-auto" onClick={retry}>
            Retry
          </Button>
        ) : null}
        {state === "sign-in-required" ? (
          <Button variant="ghost" size="sm" asChild>
            <a href={entry.server.url} target="_blank" rel="noreferrer">
              Sign in
            </a>
          </Button>
        ) : null}
      </div>
      {identity.data && !identityChanged ? (
        <iframe
          key={frameVersion}
          ref={frame}
          title={`${entry.server.name} workspace`}
          name={workspaceFrameName({
            origin: window.location.origin,
            nonce,
            serverId: identity.data.serverId,
          })}
          src={iframeUrl.toString()}
          className={`min-h-0 w-full flex-1 border-0 ${ready ? "" : "invisible"}`}
          allow="clipboard-read; clipboard-write; microphone"
          referrerPolicy="origin"
        />
      ) : null}
      {!ready || identityChanged ? (
        <div className="absolute inset-x-0 top-1/3 px-6 text-center text-sm text-muted-foreground">
          {identityChanged
            ? `This address now points to a different Kaioken installation. Connect again to open it.`
            : state === "update-required"
              ? `Update Kaioken on ${entry.server.name} to use the full connected workspace.`
              : state === "offline"
                ? `${entry.server.name} is unavailable. Reconnect to open its workspace.`
                : state === "sign-in-required"
                  ? `Sign in to connect to ${entry.server.name}.`
                  : `Connecting to ${entry.server.name}…`}
        </div>
      ) : null}
    </section>
  );
}

export function RemoteWorkspaceDeck() {
  const location = useLocation();
  const match = matchPath("/servers/:handle/*", location.pathname);
  const handle = match?.params.handle;
  const servers = useAccountServers({ enabled: workspaceEmbedding === null });
  const computers = useConnectedComputers(workspaceEmbedding === null);
  const server = computers.find((candidate) => candidate.handle === handle);
  const threadMatch = matchPath(
    "/servers/:handle/threads/:threadId",
    location.pathname,
  );
  const projectMatch = matchPath(
    "/servers/:handle/projects/:projectId",
    location.pathname,
  );
  const workspaceMatch = matchPath(
    "/servers/:handle/workspace/*",
    location.pathname,
  );
  const [entries, setEntries] = useState<WorkspaceEntry[]>([]);
  const target = useQuery({
    queryKey: [
      "connection-workspace-target",
      server?.url,
      location.pathname,
      location.search,
      location.hash,
    ],
    enabled: workspaceEmbedding === null && server !== undefined,
    queryFn: async ({ signal }) => {
      if (!server) throw new Error("Computer was not found");
      if (workspaceMatch)
        return (
          localWorkspacePath(
            `/${workspaceMatch.params["*"] ?? ""}${location.search}${location.hash}`,
          ) ?? "/"
        );
      if (projectMatch?.params.projectId)
        return `/projects/${encodeURIComponent(projectMatch.params.projectId)}${location.search}`;
      if (threadMatch?.params.threadId) {
        const thread = await getRemoteSdk(server.url).threads.get({
          threadId: threadMatch.params.threadId,
          signal,
        });
        return getThreadRoutePath({
          projectId: thread.projectId,
          threadId: thread.id,
        });
      }
      return "/";
    },
    retry: false,
    staleTime: Infinity,
  });

  useEffect(() => {
    if (!server || !target.data || workspaceEmbedding !== null) return;
    setEntries((current) => {
      const next = { server, path: target.data, navigationId: location.key };
      return [
        ...current.filter((entry) => entry.server.handle !== server.handle),
        next,
      ];
    });
  }, [location.key, server, target.data]);

  if (workspaceEmbedding !== null) return null;
  return (
    <>
      {entries.map((entry) => (
        <ConnectedWorkspace
          key={`${entry.server.handle}:${entry.server.url}`}
          entry={entry}
          active={entry.server.handle === handle}
        />
      ))}
      {handle && !entries.some((entry) => entry.server.handle === handle) ? (
        <div
          className="flex flex-1 items-center justify-center p-6 text-sm text-muted-foreground"
          role="status"
        >
          {target.isError
            ? "This computer is unavailable. Your task remains on its original computer."
            : servers.isPending || server
              ? "Connecting…"
              : "This computer is not available on your account."}
        </div>
      ) : null}
    </>
  );
}
import { requestConnectionHandoff } from "@/lib/federation/handoff-request";
