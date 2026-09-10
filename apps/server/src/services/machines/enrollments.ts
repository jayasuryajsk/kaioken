import { defaultKeyHasher } from "@better-auth/api-key";
import { getMachineProvider } from "../plugins/plugin-machine-provider-registry.js";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { and, eq, gt, sql } from "drizzle-orm";
import {
  authApiKeys,
  createHostId,
  hosts,
  machineEnrollments,
  machineLaunches,
  type DbConnection,
} from "@bb/db";
import type {
  ServerAccessGrant,
  ServerAccessSelection,
} from "@get-bb/plugin-sdk";
import type { MachineAuthService } from "../machine-auth.js";

export interface EnrollmentBootstrap {
  hostId: string;
  serverUrl: string;
  headers?: ServerAccessGrant["headers"];
  credential: string;
  expiresAt: number;
}

export type MachineEnrollment =
  | {
      id: string;
      hostId: string;
      state: "pending";
      bootstrap: EnrollmentBootstrap;
    }
  | { id: string; hostId: string; state: "enrolled" };

export interface MachineEnrollments {
  clearPending(key: string): void;
  prepare(request: {
    key: string;
    access?: ServerAccessSelection;
  }): Promise<MachineEnrollment>;
  waitForConnection(request: {
    enrollmentId: string;
    timeoutMs: number;
    signal: AbortSignal;
  }): Promise<{ hostId: string }>;
}

interface EnrollmentServiceDependencies {
  db: DbConnection;
  machineAuth: MachineAuthService;
  serverAccess: {
    resolve(request: {
      key: string;
      hostId: string;
      access?: ServerAccessSelection;
      signal: AbortSignal;
    }): Promise<ServerAccessGrant>;
    release(request: {
      key: string;
      hostId: string;
      signal: AbortSignal;
    }): Promise<void>;
  };
  isConnected(hostId: string): boolean;
}

export function createMachineEnrollmentService(
  deps: EnrollmentServiceDependencies,
) {
  const pending = new Map<
    string,
    { owner: string; bootstrap: EnrollmentBootstrap }
  >();
  const locks = new Map<string, Promise<unknown>>();

  async function serialized<T>(
    key: string,
    action: () => Promise<T>,
  ): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve();
    const current = previous.catch(() => {}).then(action);
    locks.set(key, current);
    try {
      return await current;
    } finally {
      if (locks.get(key) === current) locks.delete(key);
    }
  }

  function hasIssuedDaemonCredential(hostId: string): boolean {
    return (
      deps.db
        .select({ id: authApiKeys.id })
        .from(authApiKeys)
        .where(
          and(
            eq(authApiKeys.configId, "daemon-host"),
            eq(authApiKeys.enabled, true),
            sql`json_extract(${authApiKeys.metadata}, '$.hostId') = ${hostId}`,
          ),
        )
        .limit(1)
        .get() !== undefined
    );
  }

  async function hasUnusedEnrollmentCredential(
    hostId: string,
    credential: string,
    now: number,
  ): Promise<boolean> {
    const hashedCredential = await defaultKeyHasher(credential);
    return (
      deps.db
        .select({ id: authApiKeys.id })
        .from(authApiKeys)
        .where(
          and(
            eq(authApiKeys.configId, "daemon-enroll"),
            eq(authApiKeys.key, hashedCredential),
            eq(authApiKeys.enabled, true),
            gt(authApiKeys.remaining, 0),
            gt(authApiKeys.expiresAt, new Date(now)),
            sql`json_extract(${authApiKeys.metadata}, '$.hostId') = ${hostId}`,
          ),
        )
        .limit(1)
        .get() !== undefined
    );
  }

  function scoped(owner: string): MachineEnrollments {
    function rowForId(id: string) {
      const row = deps.db
        .select()
        .from(machineEnrollments)
        .where(
          and(
            eq(machineEnrollments.id, id),
            eq(machineEnrollments.owner, owner),
          ),
        )
        .get();
      if (!row) throw new Error("Machine enrollment was not found");
      return row;
    }
    return {
      clearPending(key) {
        const entry = pending.get(key);
        if (entry?.owner === owner) pending.delete(key);
      },
      async prepare(request) {
        if (!request.key.trim())
          throw new Error("Machine enrollment key must not be empty");
        const lockKey = JSON.stringify([owner, request.key]);
        return serialized(lockKey, async () => {
          const now = Date.now();
          const row = deps.db.transaction((tx) => {
            const launch = tx
              .select({
                providerId: machineLaunches.providerId,
                hostId: machineLaunches.hostId,
                attempt: machineLaunches.attempt,
              })
              .from(machineLaunches)
              .where(eq(machineLaunches.key, request.key))
              .get();
            if (
              launch &&
              getMachineProvider(launch.providerId)?.pluginId !== owner
            )
              throw new Error("Machine launch belongs to a different plugin");
            tx.insert(machineEnrollments)
              .values({
                id: randomUUID(),
                owner,
                key: request.key,
                hostId: launch?.hostId ?? createHostId(),
                state: "pending",
                createdAt: now,
                updatedAt: now,
              })
              .onConflictDoNothing()
              .run();
            const enrollment = tx
              .select()
              .from(machineEnrollments)
              .where(
                and(
                  eq(machineEnrollments.owner, owner),
                  eq(machineEnrollments.key, request.key),
                ),
              )
              .get();
            if (!enrollment)
              throw new Error("Machine enrollment could not be prepared");
            if (launch) {
              if (launch.hostId !== null && launch.hostId !== enrollment.hostId)
                throw new Error(
                  "Machine launch already has a different host identity",
                );
              tx.update(machineLaunches)
                .set({ hostId: enrollment.hostId })
                .where(
                  and(
                    eq(machineLaunches.key, request.key),
                    eq(machineLaunches.providerId, launch.providerId),
                    eq(machineLaunches.attempt, launch.attempt),
                  ),
                )
                .run();
            }
            return enrollment;
          });
          const host = deps.db
            .select({
              phase: hosts.phase,
              lastSeenAt: hosts.lastSeenAt,
              accessProviderId: hosts.serverAccessProviderId,
            })
            .from(hosts)
            .where(eq(hosts.id, row.hostId))
            .get();
          if (
            request.access &&
            host?.accessProviderId &&
            request.access.providerId !== host.accessProviderId
          )
            throw new Error(
              "Machine enrollment already uses a different server access provider",
            );
          if (
            host?.phase === "destroyed" ||
            (row.state === "enrolled" && !host)
          )
            throw new Error(
              "Machine enrollment identity has been removed; use a new creation key",
            );
          if (
            (host && host.lastSeenAt !== null) ||
            deps.isConnected(row.hostId)
          ) {
            pending.delete(request.key);
            deps.db
              .update(machineEnrollments)
              .set({
                state: "enrolled",
                updatedAt: now,
              })
              .where(eq(machineEnrollments.id, row.id))
              .run();
            return { id: row.id, hostId: row.hostId, state: "enrolled" };
          }
          deps.db
            .insert(hosts)
            .values({
              id: row.hostId,
              name: row.hostId,
              type: "persistent",
              createdAt: now,
              updatedAt: now,
            })
            .onConflictDoNothing()
            .run();
          const grant = await deps.serverAccess.resolve({
            key: lockKey,
            hostId: row.hostId,
            access: request.access,
            signal: AbortSignal.timeout(60_000),
          });
          await deps.machineAuth.revokeHostEnrollKeys({ hostId: row.hostId });
          const credential = await deps.machineAuth.issueHostEnrollKey({
            hostId: row.hostId,
            enrollSource: "public-multi-machine",
          });
          const expiresAt = credential.expiresAt;
          const result: Extract<MachineEnrollment, { state: "pending" }> = {
            id: row.id,
            hostId: row.hostId,
            state: "pending",
            bootstrap: {
              hostId: row.hostId,
              serverUrl: grant.serverUrl,
              ...(grant.headers === undefined
                ? {}
                : { headers: grant.headers }),
              credential: credential.key,
              expiresAt,
            },
          };
          pending.set(request.key, { owner, bootstrap: result.bootstrap });
          deps.db
            .update(machineEnrollments)
            .set({
              state: "pending",
              updatedAt: Date.now(),
            })
            .where(eq(machineEnrollments.id, row.id))
            .run();
          return result;
        });
      },
      async waitForConnection({ enrollmentId, timeoutMs, signal }) {
        if (!Number.isFinite(timeoutMs) || timeoutMs <= 0)
          throw new Error("Connection timeout must be positive");
        const deadline = Date.now() + timeoutMs;
        while (true) {
          signal.throwIfAborted();
          const row = rowForId(enrollmentId);
          if (row.state === "cancelled")
            throw new Error("Machine enrollment was cancelled");
          if (deps.isConnected(row.hostId)) {
            deps.db
              .update(machineEnrollments)
              .set({
                state: "enrolled",
                updatedAt: Date.now(),
              })
              .where(eq(machineEnrollments.id, row.id))
              .run();
            pending.delete(row.key);
            return { hostId: row.hostId };
          }
          const remaining = deadline - Date.now();
          if (remaining <= 0)
            throw new Error("Timed out waiting for machine connection");
          await delay(Math.min(250, remaining), undefined, { signal });
        }
      },
    };
  }
  function readPendingEnrollment(launchId: string, owner: string) {
    return deps.db
      .select({ enrollment: machineEnrollments, launch: machineLaunches })
      .from(machineEnrollments)
      .innerJoin(
        machineLaunches,
        and(
          eq(machineEnrollments.key, machineLaunches.key),
          eq(machineEnrollments.hostId, machineLaunches.hostId),
        ),
      )
      .where(
        and(
          eq(machineLaunches.key, launchId),
          eq(machineLaunches.phase, "creating"),
          eq(machineLaunches.cancelPending, false),
          eq(machineEnrollments.state, "pending"),
          eq(machineEnrollments.owner, owner),
        ),
      )
      .get();
  }
  async function pendingBootstrapForLaunch(request: {
    launchId: string;
    owner: string;
  }): Promise<EnrollmentBootstrap | null> {
    const read = () => readPendingEnrollment(request.launchId, request.owner);
    const row = read();
    const entry = pending.get(request.launchId);
    if (
      !row ||
      !entry ||
      entry.owner !== request.owner ||
      entry.bootstrap.expiresAt <= Date.now() ||
      deps.isConnected(row.enrollment.hostId) ||
      hasIssuedDaemonCredential(row.enrollment.hostId)
    )
      return null;
    const bootstrap = entry.bootstrap;
    if (
      !(await hasUnusedEnrollmentCredential(
        row.enrollment.hostId,
        bootstrap.credential,
        Date.now(),
      ))
    )
      return null;
    if (read() === undefined || pending.get(request.launchId) !== entry)
      return null;
    return bootstrap;
  }
  return {
    forOwner: scoped,
    pendingBootstrapForLaunch,
    async pendingBootstrapForCredential(
      credential: string,
    ): Promise<EnrollmentBootstrap | null> {
      if (!credential || credential.length > 512) return null;
      const row = [...pending].find(
        ([, entry]) => entry.bootstrap.credential === credential,
      );
      if (!row) return null;
      const [launchId, entry] = row;
      const bootstrap = await pendingBootstrapForLaunch({
        launchId,
        owner: entry.owner,
      });
      return bootstrap?.credential === credential ? bootstrap : null;
    },
  };
}
