import type { Hono } from "hono";
import {
  connectionDiscoverySchema,
  publicApiRoutes,
  typedRoutes,
  type PublicApiSchema,
  type ConnectionSelf,
} from "@kaioken/server-contract";
import type { AppDeps } from "../types.js";
import type { PluginService } from "../services/plugins/plugin-service.js";
import { resolvePrimaryHostId } from "../services/hosts/primary-host.js";
import { getServerIdentity } from "../services/connections/server-identity.js";
import { callHostOnlineRpc } from "../services/hosts/online-rpc.js";
import { ApiError } from "../errors.js";
import { registerConnectionHandoffRoutes } from "./connection-handoffs.js";

export function remoteKaiokenStartupCommand(remotePort: number): string {
  const script = `if curl -fsS --max-time 3 http://127.0.0.1:${remotePort}/api/v1/system/config >/dev/null 2>&1; then exit 0; fi\ncommand -v kaioken-app >/dev/null 2>&1 || { printf KAIOKEN_RUNTIME_MISSING >&2; exit 69; }\nmkdir -p "$HOME/.kaioken"\nnohup kaioken-app --server-port ${remotePort} > "$HOME/.kaioken/ssh-launch.log" 2>&1 < /dev/null &`;
  return `"\${SHELL:-/bin/sh}" -lc '${script.replace(/'/gu, "'\\''")}'`;
}

export function registerConnectionRoutes(
  app: Hono,
  deps: AppDeps,
  plugins: PluginService,
): void {
  registerConnectionHandoffRoutes(app, deps, plugins);
  const { get, post } = typedRoutes<PublicApiSchema>(app);
  const primary = () => {
    const id = resolvePrimaryHostId(deps);
    if (id === null)
      throw new ApiError(
        503,
        "host_unavailable",
        "This computer's host daemon is unavailable",
      );
    return id;
  };
  get(publicApiRoutes.connections.sshList, async (context) => {
    const hostId = primary();
    const result = await callHostOnlineRpc(deps, {
      hostId,
      timeoutMs: 10_000,
      command: { type: "host.ssh.list" },
    });
    return context.json({ ...result, controllerHostId: hostId });
  });
  post(publicApiRoutes.connections.sshRequest, async (context, input) => {
    const result = await callHostOnlineRpc(deps, {
      hostId: primary(),
      timeoutMs: 65_000,
      command: { ...input, type: "host.ssh.request" },
    });
    return context.json(result);
  });
  post(publicApiRoutes.connections.sshConnect, async (context, input) => {
    const remotePort = input.remotePort ?? 38886;
    const result = await callHostOnlineRpc(deps, {
      hostId: primary(),
      timeoutMs: 10_000,
      command: {
        type: "host.ssh.connect",
        alias: input.alias,
        remotePort,
        startupCommand: remoteKaiokenStartupCommand(remotePort),
      },
    });
    return context.json(result);
  });
  post(publicApiRoutes.connections.sshDisconnect, async (context, input) => {
    const result = await callHostOnlineRpc(deps, {
      hostId: primary(),
      timeoutMs: 10_000,
      command: { type: "host.ssh.disconnect", alias: input.alias },
    });
    return context.json(result);
  });
  const self = (): ConnectionSelf => ({
    serverId: getServerIdentity(deps.db),
    primaryHostId: resolvePrimaryHostId(deps),
    workspaceProtocol: 1,
  });
  get(publicApiRoutes.connections.self, (context) => context.json(self()));
  get(publicApiRoutes.connections.list, async (context) => {
    const handler = plugins.getRpcHandler("connect", "listAccountServers");
    if (handler.outcome !== "found")
      return context.json({ self: self(), discovery: null });
    const result = await plugins.invokeRpcHandler(
      "connect",
      "listAccountServers",
      handler.value,
      null,
    );
    const discovery = result.ok
      ? connectionDiscoverySchema.safeParse(result.result)
      : null;
    return context.json({
      self: self(),
      discovery: discovery?.success ? discovery.data : null,
    });
  });
}
