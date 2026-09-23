import { useEffect } from "react";
import { Navigate, useParams } from "react-router-dom";
import { getRootComposeRoutePath } from "@/lib/route-paths";
import { useOpenRemoteRootCompose } from "@/lib/root-compose-selection";

export function RemoteProjectComposeRedirect() {
  const { handle = "", projectId = "" } = useParams<{
    handle: string;
    projectId: string;
  }>();
  const openRemoteCompose = useOpenRemoteRootCompose();
  useEffect(() => {
    if (handle.length > 0 && projectId.length > 0) {
      openRemoteCompose({ handle, projectId });
    }
  }, [handle, openRemoteCompose, projectId]);
  return <Navigate to={getRootComposeRoutePath()} replace />;
}
