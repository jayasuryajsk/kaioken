import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import type { DbConnection, DbTransaction } from "../connection.js";
import { environments, hosts, machineLaunches, threads } from "../schema.js";

type Connection = DbConnection | DbTransaction;

const liveThreadCondition = or(
  and(isNull(threads.archivedAt), isNull(threads.deletedAt)),
  eq(threads.status, "stopping"),
  eq(threads.status, "active"),
);

export function listProviderMachines(db: Connection, providerId: string) {
  return db
    .select()
    .from(hosts)
    .where(eq(hosts.machineProviderId, providerId))
    .all();
}

export function machineHasLiveThreads(db: Connection, hostId: string): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(threads)
      .innerJoin(environments, eq(threads.environmentId, environments.id))
      .where(and(eq(environments.hostId, hostId), liveThreadCondition))
      .limit(1)
      .get() !== undefined
  );
}

export function machineHasLiveThreadLaunch(
  db: Connection,
  hostId: string,
): boolean {
  return (
    db
      .select({ id: threads.id })
      .from(machineLaunches)
      .innerJoin(
        threads,
        or(
          eq(machineLaunches.key, threads.id),
          sql`substr(${machineLaunches.key}, 1, length(${threads.id}) + 13) = ${threads.id} || ':replacement:'`,
        ),
      )
      .where(
        and(
          eq(machineLaunches.hostId, hostId),
          inArray(machineLaunches.phase, ["creating", "ready"]),
          liveThreadCondition,
        ),
      )
      .limit(1)
      .get() !== undefined
  );
}
