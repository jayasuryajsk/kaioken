import { and, eq, notInArray } from "drizzle-orm";
import {
  connectionHandoffs,
  type DbConnection,
  type DbTransaction,
} from "@kaioken/db";
import { ApiError } from "../../errors.js";

type Connection = DbConnection | DbTransaction;
export type HandoffRow = typeof connectionHandoffs.$inferSelect;
export function getHandoff(
  db: Connection,
  id: string,
  role: HandoffRow["role"],
) {
  return (
    db
      .select()
      .from(connectionHandoffs)
      .where(
        and(eq(connectionHandoffs.id, id), eq(connectionHandoffs.role, role)),
      )
      .get() ?? null
  );
}
export function insertHandoff(
  db: Connection,
  args: Omit<HandoffRow, "createdAt" | "updatedAt">,
) {
  const now = Date.now();
  db.insert(connectionHandoffs)
    .values({ ...args, createdAt: now, updatedAt: now })
    .run();
}
export function updateHandoff(
  db: Connection,
  id: string,
  role: HandoffRow["role"],
  values: Partial<
    Pick<HandoffRow, "phase" | "payload" | "error" | "targetThreadId">
  >,
) {
  db.update(connectionHandoffs)
    .set({ ...values, updatedAt: Date.now() })
    .where(
      and(eq(connectionHandoffs.id, id), eq(connectionHandoffs.role, role)),
    )
    .run();
}
export function assertThreadHasNoConnectionHandoff(
  db: Connection,
  threadId: string,
): void {
  const operation = db
    .select({ id: connectionHandoffs.id })
    .from(connectionHandoffs)
    .where(
      and(
        eq(connectionHandoffs.sourceThreadId, threadId),
        eq(connectionHandoffs.role, "source"),
        notInArray(connectionHandoffs.phase, ["cancelled", "complete"]),
      ),
    )
    .get();
  if (operation)
    throw new ApiError(
      409,
      "thread_handoff_in_progress",
      "This task is moving to another computer. Finish or cancel its handoff before continuing.",
      { details: { operationId: operation.id } },
    );
}
const running = new Map<string, Promise<unknown>>();
const mutations = new WeakMap<DbConnection, Map<string, number>>();

export function assertNoThreadMutationInFlight(
  db: DbConnection,
  threadId: string,
): void {
  if ((mutations.get(db)?.get(threadId) ?? 0) > 0)
    throw new ApiError(
      409,
      "handoff_source_busy",
      "The task is processing another change. Retry the move once it finishes.",
    );
}

export async function withThreadHandoffMutationGuard<T>(
  db: DbConnection,
  threadId: string,
  action: () => Promise<T>,
): Promise<T> {
  assertThreadHasNoConnectionHandoff(db, threadId);
  let counts = mutations.get(db);
  if (!counts) {
    counts = new Map();
    mutations.set(db, counts);
  }
  counts.set(threadId, (counts.get(threadId) ?? 0) + 1);
  try {
    return await action();
  } finally {
    const remaining = (counts.get(threadId) ?? 1) - 1;
    if (remaining === 0) counts.delete(threadId);
    else counts.set(threadId, remaining);
  }
}

export async function runHandoffOnce<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = running.get(key) ?? Promise.resolve();
  const result = previous.catch(() => undefined).then(action);
  running.set(key, result);
  try {
    return await result;
  } finally {
    if (running.get(key) === result) running.delete(key);
  }
}
