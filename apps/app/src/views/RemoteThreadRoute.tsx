import { useCallback, useMemo } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { RouteLoadingSkeleton } from "@/components/ui/route-loading-skeleton";
import { useThread } from "@/hooks/queries/thread-queries";
import { getRemoteThreadRoutePath } from "@/lib/route-paths";
import type { ThreadRoutePathArgs } from "@/lib/route-paths";
import { ThreadDetailView } from "./thread-detail/ThreadDetailView";
import {
  PaneContext,
  type PaneContextValue,
} from "./thread-detail/PaneContext";

export function RemoteThreadRoute() {
  const { handle = "", threadId = "" } = useParams<{
    handle: string;
    threadId: string;
  }>();
  const navigate = useNavigate();
  const thread = useThread(threadId);
  const navigateInPane = useCallback(
    (target: ThreadRoutePathArgs) => {
      navigate(getRemoteThreadRoutePath({ handle, threadId: target.threadId }));
    },
    [handle, navigate],
  );
  const pane = useMemo<PaneContextValue>(
    () => ({
      paneId: `remote:${handle}`,
      isFocused: true,
      isSplitPane: false,
      secondaryPanelHost: null,
      reservesWindowPanelToggle: false,
      onRequestClose: null,
      isMaximized: false,
      onToggleMaximize: null,
      isBoundedPane: false,
      isTopRow: true,
      ownsWindowTopLeft: true,
      navigateInPane,
    }),
    [handle, navigateInPane],
  );

  if (thread.data === undefined) {
    if (thread.isError) {
      return (
        <p className="p-6 text-sm text-muted-foreground" role="status">
          This thread is not available on that computer.
        </p>
      );
    }
    return <RouteLoadingSkeleton isBoundedPane={false} />;
  }

  return (
    <PaneContext.Provider value={pane}>
      <ThreadDetailView
        surface="pane"
        projectId={thread.data.projectId}
        threadId={thread.data.id}
      />
    </PaneContext.Provider>
  );
}
