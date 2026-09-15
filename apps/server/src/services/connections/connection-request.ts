import type { Hono } from "hono";
import { z } from "zod";
import {
  CONNECTION_IDENTITY_HEADER,
  connectionDiscoverySchema,
  type HandoffConnection,
} from "@kaioken/server-contract";
import type { AppDeps } from "../../types.js";
import type { PluginService } from "../plugins/plugin-service.js";
import { ApiError } from "../../errors.js";
import { callHostOnlineRpc } from "../hosts/online-rpc.js";
import { requireConnectedPrimaryHostId } from "../hosts/primary-host.js";
import { getServerIdentity } from "./server-identity.js";

const cookieSchema = z.object({
  cookie: z.object({
    name: z.string().regex(/^[!#$%&'*+.^_`|~0-9a-zA-Z-]+$/u),
    value: z.string().regex(/^[^;\r\n]+$/u),
    domain: z.string(),
    expiresAt: z.number(),
  }),
});
const apiErrorSchema = z.object({ message: z.string() });
export interface ConnectionRequest {
  <T>(
    target: Omit<HandoffConnection, "serverId"> & { serverId: string | null },
    endpoint: string,
    input: object,
    schema: z.ZodType<T>,
  ): Promise<T>;
}
export function createConnectionRequest(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
): ConnectionRequest {
  const pluginRpc = async (method: string) => {
    const handler = plugins.getRpcHandler("connect", method);
    if (handler.outcome !== "found")
      throw new ApiError(
        503,
        "connection_unavailable",
        "Connect is not available on this computer",
      );
    const result = await plugins.invokeRpcHandler(
      "connect",
      method,
      handler.value,
      null,
    );
    if (!result.ok)
      throw new ApiError(
        503,
        "connection_unavailable",
        "Connect could not authenticate this computer",
      );
    return result.result;
  };
  return async (target, endpoint, input, schema) => {
    if (!/^\/[a-z/-]+$/u.test(endpoint))
      throw new Error("Invalid handoff endpoint");
    const headers = {
      "content-type": "application/json",
      ...(target.serverId === null
        ? {}
        : { [CONNECTION_IDENTITY_HEADER]: target.serverId }),
    };
    const body = JSON.stringify(input);
    const isSelf = endpoint === "/self";
    const apiPath = isSelf
      ? "/connections/self"
      : `/connections/handoffs${endpoint}`;
    const method = isSelf ? "GET" : "POST";
    let response: Response;
    if (target.handle === null) {
      if (
        target.serverId !== null &&
        target.serverId !== getServerIdentity(deps.db)
      )
        throw new ApiError(
          409,
          "connection_identity_changed",
          "This connection points to a different Kaioken installation",
        );
      response = await app.request(apiPath, {
        method,
        headers,
        ...(isSelf ? {} : { body }),
      });
    } else if (target.handle.startsWith("ssh.")) {
      const result = await callHostOnlineRpc(deps, {
        hostId: requireConnectedPrimaryHostId(deps),
        timeoutMs: 125_000,
        command: {
          type: "host.ssh.request",
          alias: target.handle.slice(4),
          path: `/api/v1${apiPath}`,
          method,
          headers,
          body: isSelf ? null : Buffer.from(body).toString("base64"),
        },
      });
      response = new Response(
        Uint8Array.from(Buffer.from(result.body, "base64")),
        { status: result.status, headers: result.headers },
      );
    } else {
      const discovery = connectionDiscoverySchema.parse(
        await pluginRpc("listAccountServers"),
      );
      const server = discovery.servers.find(
        (entry) => entry.handle === target.handle,
      );
      if (!server)
        throw new ApiError(
          404,
          "connection_not_found",
          "This computer is no longer in your connected account",
        );
      const url = new URL(server.url);
      if (url.protocol !== "https:" || url.username || url.password)
        throw new ApiError(
          400,
          "invalid_connection",
          "Account connections require an authenticated HTTPS origin",
        );
      const { cookie } = cookieSchema.parse(
        await pluginRpc("createDesktopSession"),
      );
      const domain = cookie.domain.replace(/^\./u, "");
      if (url.hostname !== domain && !url.hostname.endsWith(`.${domain}`))
        throw new ApiError(
          403,
          "invalid_connection",
          "The connection is outside the account session's domain",
        );
      response = await fetch(new URL(`/api/v1${apiPath}`, url.origin), {
        method,
        headers: { ...headers, cookie: `${cookie.name}=${cookie.value}` },
        ...(isSelf ? {} : { body }),
        redirect: "error",
        signal: AbortSignal.timeout(125_000),
      });
    }
    const value: unknown = await response.json();
    if (!response.ok) {
      const parsed = apiErrorSchema.safeParse(value);
      throw new Error(
        parsed.success
          ? parsed.data.message
          : `The connected computer returned HTTP ${response.status}`,
      );
    }
    return schema.parse(value);
  };
}
