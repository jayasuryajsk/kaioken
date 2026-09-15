import { z } from "zod";

export const CONNECTION_CONTROLLER_PARAM = "connectionController";
export const CONNECTION_NONCE_PARAM = "connectionNonce";
export const CONNECTION_IDENTITY_PARAM = "connectionServerId";
const FRAME_NAME_PREFIX = "kaioken:workspace:";
const embeddingSchema = z.object({
  origin: z.string().url(),
  nonce: z.string().uuid(),
  serverId: z.string().uuid(),
});

export function localWorkspacePath(path: string): string | null {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\"))
    return null;
  const base = "https://workspace.invalid";
  const url = new URL(path, base);
  if (url.origin !== base || url.pathname.startsWith("/servers/")) return null;
  url.searchParams.delete(CONNECTION_CONTROLLER_PARAM);
  url.searchParams.delete(CONNECTION_NONCE_PARAM);
  url.searchParams.delete(CONNECTION_IDENTITY_PARAM);
  return `${url.pathname}${url.search}${url.hash}`;
}

export function readWorkspaceEmbedding() {
  if (typeof window === "undefined" || window.parent === window) return null;
  const query = new URLSearchParams(window.location.search);
  try {
    const candidate = query.has(CONNECTION_CONTROLLER_PARAM)
      ? {
          origin: query.get(CONNECTION_CONTROLLER_PARAM),
          nonce: query.get(CONNECTION_NONCE_PARAM),
          serverId: query.get(CONNECTION_IDENTITY_PARAM),
        }
      : window.name.startsWith(FRAME_NAME_PREFIX)
        ? JSON.parse(window.name.slice(FRAME_NAME_PREFIX.length))
        : null;
    const parsed = embeddingSchema.safeParse(candidate);
    if (!parsed.success) return null;
    const controller = parsed.data.origin;
    const url = new URL(controller);
    if (
      !["http:", "https:"].includes(url.protocol) ||
      url.origin !== controller
    )
      return null;
    const referrer = new URL(document.referrer).origin;
    if (
      referrer !== controller &&
      !(
        window.name.startsWith(FRAME_NAME_PREFIX) &&
        referrer === window.location.origin
      )
    )
      return null;
    window.name = `${FRAME_NAME_PREFIX}${JSON.stringify(parsed.data)}`;
    return parsed.data;
  } catch {
    return null;
  }
}

export const workspaceEmbedding = readWorkspaceEmbedding();

export function workspaceFrameName(
  embedding: z.infer<typeof embeddingSchema>,
): string {
  return `${FRAME_NAME_PREFIX}${JSON.stringify(embedding)}`;
}

export function withWorkspaceIdentity(url: string): string {
  if (!workspaceEmbedding) return url;
  const target = new URL(url);
  target.searchParams.set(
    CONNECTION_IDENTITY_PARAM,
    workspaceEmbedding.serverId,
  );
  return target.toString();
}
