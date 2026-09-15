import { z } from "zod";
import {
  sshAliasSchema,
  sshConnectionListSchema,
} from "@kaioken/host-daemon-contract";

export const CONNECTION_IDENTITY_HEADER = "x-kaioken-server-id";
export const accountConnectionHandleSchema = z
  .string()
  .regex(/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u);
export const connectionResolveRequestSchema = z
  .object({ handle: z.string().min(1).nullable() })
  .strict();

export const sshConnectRequestSchema = z
  .object({
    alias: sshAliasSchema,
    remotePort: z.number().int().min(1).max(65535).default(38886),
  })
  .strict();
export type SshConnectRequest = z.input<typeof sshConnectRequestSchema>;
export const sshDisconnectRequestSchema = z
  .object({ alias: sshAliasSchema })
  .strict();
export const sshConnectionsResponseSchema = sshConnectionListSchema.extend({
  controllerHostId: z.string(),
});
export type SshConnectionsResponse = z.infer<
  typeof sshConnectionsResponseSchema
>;

export const connectionSelfSchema = z.object({
  serverId: z.string().uuid(),
  primaryHostId: z.string().nullable(),
  workspaceProtocol: z.literal(1),
});

export type ConnectionSelf = z.infer<typeof connectionSelfSchema>;

export const connectionDiscoverySchema = z.object({
  servers: z.array(
    z.object({
      handle: accountConnectionHandleSchema,
      name: z.string().min(1),
      live: z.boolean(),
      url: z.string().url(),
    }),
  ),
  selfHandle: accountConnectionHandleSchema,
});

export const connectionListSchema = z.object({
  self: connectionSelfSchema,
  discovery: connectionDiscoverySchema.nullable(),
});
export type ConnectionList = z.infer<typeof connectionListSchema>;

export const connectionWorkspaceTargetSchema = z.object({
  serverId: z.string().uuid(),
  hostId: z.string().nullable(),
  resource: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("thread"), id: z.string().min(1) }),
    z.object({ kind: z.literal("project"), id: z.string().min(1) }),
  ]),
});
export type ConnectionWorkspaceTarget = z.infer<
  typeof connectionWorkspaceTargetSchema
>;
