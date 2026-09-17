import { matchPath, Navigate, useLocation, useParams } from "react-router-dom";
import {
  getRemoteProjectComposeRoutePath,
  getRemoteThreadRoutePath,
} from "@/lib/route-paths";
import { localWorkspacePath } from "./workspace-protocol";

export function resolveLegacyRemotePath(handle: string, path: string): string {
  const local = localWorkspacePath(path);
  if (local === null) return "/";
  const url = new URL(local, "https://workspace.invalid");
  const thread =
    matchPath("/projects/:projectId/threads/:threadId", url.pathname) ??
    matchPath("/threads/:threadId", url.pathname);
  if (thread?.params.threadId)
    return (
      getRemoteThreadRoutePath({ handle, threadId: thread.params.threadId }) +
      url.search +
      url.hash
    );
  const project = matchPath("/projects/:projectId", url.pathname);
  if (project?.params.projectId)
    return (
      getRemoteProjectComposeRoutePath({
        handle,
        projectId: project.params.projectId,
      }) +
      url.search +
      url.hash
    );
  return "/";
}

export function LegacyRemoteRoute() {
  const { handle, "*": path } = useParams<{ handle: string; "*": string }>();
  const { search, hash } = useLocation();
  const local = path?.startsWith("workspace/")
    ? `/${path.slice("workspace/".length)}`
    : "/";
  return (
    <Navigate
      replace
      to={handle ? resolveLegacyRemotePath(handle, local + search + hash) : "/"}
    />
  );
}
