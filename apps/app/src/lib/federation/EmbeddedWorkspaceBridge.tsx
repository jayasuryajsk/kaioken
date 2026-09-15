import { workspaceControllerMessageSchema } from "@/lib/federation/workspace-messages";
import { useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { sdk } from "@/lib/sdk";
import { useAccountServers } from "@/hooks/queries/federation-queries";
import { useServerConnectionState } from "@/hooks/useServerConnectionState";
import { receiveWorkspaceDraft, workspaceDraftId } from "./workspace-drafts";
import { HANDOFF_REQUEST_EVENT, handoffRequestSchema } from "./handoff-request";
import { localWorkspacePath, workspaceEmbedding } from "./workspace-protocol";

export function EmbeddedWorkspaceBridge() {
  const location = useLocation();
  const navigate = useNavigate();
  const navigateRef = useRef(navigate);
  navigateRef.current = navigate;
  const navigationId = useRef("");
  const self = useQuery({
    queryKey: ["connection-self"],
    queryFn: () => sdk.experimental_connections.self(),
    enabled: workspaceEmbedding !== null,
  });
  const accounts = useAccountServers({ enabled: workspaceEmbedding !== null });
  const state = useServerConnectionState();
  const controller =
    workspaceEmbedding === null ? null : new URL(workspaceEmbedding.origin);
  const trusted =
    controller !== null &&
    (controller.origin === window.location.origin ||
      (controller.protocol === "http:" &&
        ["localhost", "127.0.0.1", "[::1]"].includes(controller.hostname)) ||
      accounts.data?.some(
        (server) => new URL(server.url).origin === controller.origin,
      ));

  useEffect(() => {
    const embedding = workspaceEmbedding;
    if (!embedding || !trusted || !self.data) return;
    const listener = (event: MessageEvent) => {
      if (event.source !== window.parent || event.origin !== embedding.origin)
        return;
      const parsed = workspaceControllerMessageSchema.safeParse(event.data);
      if (!parsed.success || parsed.data.nonce !== embedding.nonce) return;
      const path = localWorkspacePath(parsed.data.path);
      if (path === null) return;
      const draft = parsed.data.draft;
      if (draft !== null) {
        if (
          workspaceDraftId(new URL(path, window.location.origin).search) !==
          draft.id
        )
          return;
        receiveWorkspaceDraft(draft);
        window.parent.postMessage(
          {
            type: "kaioken:workspace-draft-accepted",
            nonce: embedding.nonce,
            navigationId: parsed.data.navigationId,
            draftId: draft.id,
          },
          embedding.origin,
        );
      }
      navigationId.current = parsed.data.navigationId;
      navigateRef.current(path, { replace: true });
    };
    window.addEventListener("message", listener);
    const handoff = (event: Event) => {
      if (!(event instanceof CustomEvent)) return;
      const request = handoffRequestSchema.safeParse(event.detail);
      if (!request.success) return;
      window.parent.postMessage(
        {
          type: "kaioken:workspace-handoff",
          nonce: embedding.nonce,
          navigationId: navigationId.current,
          threadId: request.data.threadId,
        },
        embedding.origin,
      );
    };
    window.addEventListener(HANDOFF_REQUEST_EVENT, handoff);
    window.parent.postMessage(
      {
        type: "kaioken:workspace-ready",
        nonce: embedding.nonce,
        navigationId: "",
        serverId: self.data.serverId,
      },
      embedding.origin,
    );
    return () => {
      window.removeEventListener("message", listener);
      window.removeEventListener(HANDOFF_REQUEST_EVENT, handoff);
    };
  }, [self.data, trusted]);

  useEffect(() => {
    const embedding = workspaceEmbedding;
    if (!embedding || !trusted || !self.data) return;
    const path = localWorkspacePath(
      `${location.pathname}${location.search}${location.hash}`,
    );
    if (path !== null)
      window.parent.postMessage(
        {
          type: "kaioken:workspace-location",
          nonce: embedding.nonce,
          navigationId: navigationId.current,
          path,
        },
        embedding.origin,
      );
  }, [location, self.data, trusted]);

  useEffect(() => {
    const embedding = workspaceEmbedding;
    if (!embedding || !trusted || !self.data) return;
    window.parent.postMessage(
      {
        type: "kaioken:workspace-state",
        nonce: embedding.nonce,
        navigationId: navigationId.current,
        state,
      },
      embedding.origin,
    );
  }, [self.data, state, trusted]);
  return null;
}
