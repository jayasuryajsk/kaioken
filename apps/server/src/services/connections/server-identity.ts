import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { appSettingsValues, type DbConnection } from "@kaioken/db";
import { z } from "zod";

const SERVER_ID_KEY = "connections.serverId";

export function getServerIdentity(db: DbConnection): string {
  const existing = db
    .select({ value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(eq(appSettingsValues.key, SERVER_ID_KEY))
    .get();
  if (existing) return z.string().uuid().parse(existing.value);
  const id = randomUUID();
  db.insert(appSettingsValues)
    .values({ key: SERVER_ID_KEY, value: id, updatedAt: Date.now() })
    .onConflictDoNothing()
    .run();
  const stored = db
    .select({ value: appSettingsValues.value })
    .from(appSettingsValues)
    .where(eq(appSettingsValues.key, SERVER_ID_KEY))
    .get();
  return z.string().uuid().parse(stored?.value);
}
