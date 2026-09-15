import {
  handoffPreviewSchema,
  handoffStatusSchema,
  type HandoffPreviewRequest,
  type HandoffStartRequest,
  type HandoffPreview,
  type HandoffStatus,
  connectionSelfSchema,
  connectionListSchema,
  sshConnectionsResponseSchema,
  type ConnectionSelf,
  type ConnectionList,
  type SshConnectRequest,
  type SshConnectionsResponse,
} from "@kaioken/server-contract";
import {
  sshConnectionSchema,
  type SshConnection,
} from "@kaioken/host-daemon-contract";
import { signalRequestArgs, type CreateSdkAreaArgs } from "./common.js";

export interface ConnectionsReadArgs {
  signal?: AbortSignal;
}

export interface ExperimentalConnectionsArea {
  resolve(args: { handle: string | null }): Promise<ConnectionSelf>;
  handoffs: {
    preview(args: HandoffPreviewRequest): Promise<HandoffPreview>;
    start(args: HandoffStartRequest): Promise<HandoffStatus>;
    get(args: { id: string; signal?: AbortSignal }): Promise<HandoffStatus>;
    retry(args: { id: string }): Promise<HandoffStatus>;
    cancel(args: { id: string }): Promise<HandoffStatus>;
  };
  self(args?: ConnectionsReadArgs): Promise<ConnectionSelf>;
  list(args?: ConnectionsReadArgs): Promise<ConnectionList>;
  ssh: {
    list(args?: ConnectionsReadArgs): Promise<SshConnectionsResponse>;
    connect(args: SshConnectRequest): Promise<SshConnection>;
    disconnect(args: { alias: string }): Promise<{ ok: true }>;
  };
}

export function createConnectionsArea({
  transport,
}: CreateSdkAreaArgs): ExperimentalConnectionsArea {
  return {
    async resolve(args) {
      return connectionSelfSchema.parse(
        await transport.readJson(
          transport.api.v1.connections.resolve.$post({ json: args }),
        ),
      );
    },
    handoffs: {
      async preview(args) {
        return handoffPreviewSchema.parse(
          await transport.readJson(
            transport.api.v1.connections.handoffs.preview.$post({ json: args }),
          ),
        );
      },
      async start(args) {
        return handoffStatusSchema.parse(
          await transport.readJson(
            transport.api.v1.connections.handoffs.$post({ json: args }),
          ),
        );
      },
      async get(args) {
        return handoffStatusSchema.parse(
          await transport.readJson(
            transport.api.v1.connections.handoffs[":id"].$get(
              { param: { id: args.id } },
              ...signalRequestArgs(args.signal),
            ),
          ),
        );
      },
      async retry(args) {
        return handoffStatusSchema.parse(
          await transport.readJson(
            transport.api.v1.connections.handoffs.action.$post({
              json: { ...args, action: "retry" },
            }),
          ),
        );
      },
      async cancel(args) {
        return handoffStatusSchema.parse(
          await transport.readJson(
            transport.api.v1.connections.handoffs.action.$post({
              json: { ...args, action: "cancel" },
            }),
          ),
        );
      },
    },
    ssh: {
      async list(args) {
        return sshConnectionsResponseSchema.parse(
          await transport.readJson(
            transport.api.v1.connections.ssh.$get(
              {},
              ...signalRequestArgs(args?.signal),
            ),
          ),
        );
      },
      async connect(args) {
        return sshConnectionSchema.parse(
          await transport.readJson(
            transport.api.v1.connections.ssh.connect.$post({ json: args }),
          ),
        );
      },
      async disconnect(args) {
        return transport.readJson(
          transport.api.v1.connections.ssh.disconnect.$post({ json: args }),
        );
      },
    },
    async self(args) {
      return connectionSelfSchema.parse(
        await transport.readJson(
          transport.api.v1.connections.self.$get(
            {},
            ...signalRequestArgs(args?.signal),
          ),
        ),
      );
    },
    async list(args) {
      return connectionListSchema.parse(
        await transport.readJson(
          transport.api.v1.connections.$get(
            {},
            ...signalRequestArgs(args?.signal),
          ),
        ),
      );
    },
  };
}
