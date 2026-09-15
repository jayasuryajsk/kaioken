import {
  APP_SURFACE_DESKTOP,
  APP_SURFACE_HEADER_NAME,
  APP_SURFACE_WEB,
  type RequestAppSurface,
} from "@kaioken/config/app-surface";
import { isInsideNativeShell } from "@/lib/native-shell";
import { CONNECTION_IDENTITY_HEADER } from "@kaioken/server-contract";
import { workspaceEmbedding } from "./federation/workspace-protocol";

const APP_SURFACE_MOBILE: RequestAppSurface = "mobile";

export function getAppSurface(): RequestAppSurface {
  if (typeof window !== "undefined" && window.kaiokenDesktop !== undefined) {
    return APP_SURFACE_DESKTOP;
  }
  if (isInsideNativeShell()) {
    return APP_SURFACE_MOBILE;
  }
  return APP_SURFACE_WEB;
}

export function appSurfaceRequestInit(init?: RequestInit): RequestInit {
  const headers = new Headers(init?.headers);
  headers.set(APP_SURFACE_HEADER_NAME, getAppSurface());
  if (workspaceEmbedding)
    headers.set(CONNECTION_IDENTITY_HEADER, workspaceEmbedding.serverId);
  return {
    ...init,
    headers,
  };
}

export function fetchWithAppSurface(
  input: Parameters<typeof fetch>[0],
  init?: RequestInit,
): ReturnType<typeof fetch> {
  const url = new URL(
    input instanceof Request ? input.url : input,
    typeof window === "undefined" ? "http://localhost" : window.location.href,
  );
  if (typeof window !== "undefined" && url.origin !== window.location.origin)
    return fetch(input, init);
  return fetch(
    input,
    appSurfaceRequestInit({
      ...init,
      headers:
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
    }),
  );
}
