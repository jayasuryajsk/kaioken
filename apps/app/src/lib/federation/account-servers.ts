import { z } from "zod";
import type { FederatedServer } from "@kaioken/client-core";

export const FEDERATION_SERVERS_STORAGE_KEY = "kaioken.federation.servers";
export const FEDERATION_MOCK_SERVERS_STORAGE_KEY =
  "kaioken.federation.mockServers";

const accountServerSchema = z
  .object({
    handle: z.string().min(1),
    name: z.string().min(1),
    live: z.boolean(),
    url: z.string().min(1),
    lastSeenAt: z.number().nullable().optional(),
  })
  .passthrough();

export const listAccountServersResultSchema = z
  .object({
    servers: z.array(accountServerSchema),
    selfHandle: z.string().min(1),
  })
  .passthrough();

export type ListAccountServersResult = z.infer<
  typeof listAccountServersResultSchema
>;

const storedServersSchema = z.array(
  z.object({
    handle: z.string().min(1),
    name: z.string().min(1),
    url: z.string().min(1),
    live: z.boolean(),
    lastSeenAt: z.number().nullable(),
    home: z.boolean(),
  }),
);

export function toFederatedServers(
  result: ListAccountServersResult,
  now: number,
  previous: readonly FederatedServer[] = [],
): FederatedServer[] {
  const previousByHandle = new Map(
    previous.map((server) => [server.handle, server]),
  );
  return result.servers.map((server) => {
    const earlier = previousByHandle.get(server.handle);
    const lastSeenAt = server.live
      ? now
      : (server.lastSeenAt ?? earlier?.lastSeenAt ?? null);
    return {
      handle: server.handle,
      name: server.name,
      url: server.url.replace(/\/$/u, ""),
      live: server.live,
      lastSeenAt,
      home: server.handle === result.selfHandle,
    };
  });
}

export function readStoredServers(): FederatedServer[] {
  try {
    const raw = window.localStorage.getItem(FEDERATION_SERVERS_STORAGE_KEY);
    if (raw === null) return [];
    const parsed = storedServersSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : [];
  } catch {
    return [];
  }
}

export function writeStoredServers(servers: readonly FederatedServer[]): void {
  try {
    window.localStorage.setItem(
      FEDERATION_SERVERS_STORAGE_KEY,
      JSON.stringify(servers),
    );
  } catch {
    return;
  }
}

export function readMockAccountServers(): ListAccountServersResult | null {
  try {
    const raw = window.localStorage.getItem(
      FEDERATION_MOCK_SERVERS_STORAGE_KEY,
    );
    if (raw === null) return null;
    const parsed = listAccountServersResultSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
