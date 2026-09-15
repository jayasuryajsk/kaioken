import { z } from "zod";

const identitiesSchema = z.record(z.string(), z.string().uuid());
const STORAGE_KEY = "kaioken.connections.identities.v1";

function readIdentities(): Record<string, string> {
  try {
    return identitiesSchema.parse(
      JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "{}"),
    );
  } catch {
    return {};
  }
}

export function readConnectionIdentity(
  origin: string,
  handle?: string,
): string | null {
  const identities = readIdentities();
  return (
    (handle ? identities[`computer:${handle}`] : undefined) ??
    identities[origin] ??
    null
  );
}

export function rememberConnectionIdentity(
  origin: string,
  serverId: string,
  handle?: string,
): void {
  const identity = z.string().uuid().parse(serverId);
  try {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        ...readIdentities(),
        [origin]: identity,
        ...(handle ? { [`computer:${handle}`]: identity } : {}),
      }),
    );
  } catch {}
}

export function bindConnectionIdentity(origin: string, handle: string): void {
  const identity = readConnectionIdentity(origin, handle);
  if (identity !== null) rememberConnectionIdentity(origin, identity, handle);
}
