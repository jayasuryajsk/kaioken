import { and, asc, eq, isNull } from "drizzle-orm";
import { PERSONAL_PROJECT_ID } from "@kaioken/domain";
import type {
  DbConnection,
  DbQueryConnection,
  DbTransaction,
} from "../connection.js";
import { createThreadSectionId } from "../ids.js";
import type { DbNotifier } from "../notifier.js";
import {
  projects,
  threadSectionProjects,
  threadSections,
  threads,
} from "../schema.js";

type ThreadSectionWriteConnection = DbConnection | DbTransaction;

export type ThreadSectionRow = typeof threadSections.$inferSelect;

export interface CreateThreadSectionInput {
  name: string;
}

export interface RenameThreadSectionInput {
  id: string;
  name: string;
}

export interface DeleteThreadSectionInput {
  id: string;
}

export interface SetProjectThreadSectionInput {
  projectId: string;
  sectionId: string | null;
}

export type SetProjectThreadSectionResult =
  | { status: "updated"; previousSectionId: string | null }
  | { status: "project_not_found" }
  | { status: "section_not_found" };

export interface ThreadSectionMutationResult {
  id: string;
  name: string;
  updatedThreadCount: number;
  updatedProjectCount: number;
}

export type CreateThreadSectionResult =
  | { status: "created"; section: ThreadSectionRow }
  | { status: "duplicate"; section: ThreadSectionRow };

export type RenameThreadSectionResult =
  | { status: "renamed"; result: ThreadSectionMutationResult }
  | { status: "duplicate"; section: ThreadSectionRow }
  | { status: "not_found" };

export function normalizeThreadSectionName(
  name: string | null | undefined,
): string | null {
  const normalized = (name ?? "").trim();
  return normalized.length > 0 ? normalized : null;
}

function notifyThreadSectionListChanged(notifier: DbNotifier): void {
  notifier.notifyProject(PERSONAL_PROJECT_ID, ["threads-changed"]);
}

function notifyThreadSectionMutationProjects(
  notifier: DbNotifier,
  projectIds: ReadonlySet<string>,
): void {
  notifyThreadSectionListChanged(notifier);
  for (const projectId of projectIds) {
    notifier.notifyProject(projectId, ["threads-changed"]);
  }
}

export function getThreadSectionById(
  db: DbQueryConnection,
  id: string,
): ThreadSectionRow | null {
  return (
    db.select().from(threadSections).where(eq(threadSections.id, id)).get() ??
    null
  );
}

function getThreadSectionByName(
  db: DbQueryConnection,
  name: string,
): ThreadSectionRow | null {
  const normalized = normalizeThreadSectionName(name);
  if (!normalized) {
    return null;
  }
  return (
    db
      .select()
      .from(threadSections)
      .where(eq(threadSections.name, normalized))
      .get() ?? null
  );
}

export function listThreadSections(db: DbQueryConnection): ThreadSectionRow[] {
  return db
    .select()
    .from(threadSections)
    .orderBy(asc(threadSections.name), asc(threadSections.id))
    .all();
}

export function listThreadSectionProjectIds(
  db: DbQueryConnection,
): Map<string, string[]> {
  const rows = db
    .select({
      projectId: threadSectionProjects.projectId,
      sectionId: threadSectionProjects.sectionId,
    })
    .from(threadSectionProjects)
    .innerJoin(projects, eq(projects.id, threadSectionProjects.projectId))
    .where(isNull(projects.deletedAt))
    .orderBy(asc(projects.sortKey), asc(projects.id))
    .all();
  const bySection = new Map<string, string[]>();
  for (const row of rows) {
    const existing = bySection.get(row.sectionId);
    if (existing) {
      existing.push(row.projectId);
    } else {
      bySection.set(row.sectionId, [row.projectId]);
    }
  }
  return bySection;
}

export function getProjectThreadSectionId(
  db: DbQueryConnection,
  projectId: string,
): string | null {
  return (
    db
      .select({ sectionId: threadSectionProjects.sectionId })
      .from(threadSectionProjects)
      .where(eq(threadSectionProjects.projectId, projectId))
      .get()?.sectionId ?? null
  );
}

export function setProjectThreadSection(
  db: DbConnection,
  notifier: DbNotifier,
  input: SetProjectThreadSectionInput,
): SetProjectThreadSectionResult {
  return db.transaction(
    (tx): SetProjectThreadSectionResult => {
      const project = tx
        .select({ id: projects.id })
        .from(projects)
        .where(
          and(eq(projects.id, input.projectId), isNull(projects.deletedAt)),
        )
        .get();
      if (!project) {
        return { status: "project_not_found" };
      }
      if (
        input.sectionId !== null &&
        !getThreadSectionById(tx, input.sectionId)
      ) {
        return { status: "section_not_found" };
      }
      const previousSectionId = getProjectThreadSectionId(tx, input.projectId);
      if (previousSectionId === input.sectionId) {
        return { status: "updated", previousSectionId };
      }
      tx.delete(threadSectionProjects)
        .where(eq(threadSectionProjects.projectId, input.projectId))
        .run();
      if (input.sectionId !== null) {
        tx.insert(threadSectionProjects)
          .values({
            projectId: input.projectId,
            sectionId: input.sectionId,
            createdAt: Date.now(),
          })
          .run();
      }
      tx.update(projects)
        .set({ updatedAt: Date.now() })
        .where(eq(projects.id, input.projectId))
        .run();
      notifier.notifyProject(input.projectId, ["project-updated"]);
      notifyThreadSectionListChanged(notifier);
      return { status: "updated", previousSectionId };
    },
    { behavior: "immediate" },
  );
}

export function createThreadSection(
  db: ThreadSectionWriteConnection,
  notifier: DbNotifier,
  input: CreateThreadSectionInput,
): CreateThreadSectionResult {
  const name = normalizeThreadSectionName(input.name);
  if (!name) {
    throw new Error("Thread section name cannot be empty");
  }

  const existing = getThreadSectionByName(db, name);
  if (existing) {
    return { status: "duplicate", section: existing };
  }

  const now = Date.now();
  const section = db
    .insert(threadSections)
    .values({
      id: createThreadSectionId(),
      name,
      createdAt: now,
      updatedAt: now,
    })
    .returning()
    .get();
  notifyThreadSectionListChanged(notifier);
  return { status: "created", section };
}

export function renameThreadSection(
  db: DbConnection,
  notifier: DbNotifier,
  input: RenameThreadSectionInput,
): RenameThreadSectionResult {
  const name = normalizeThreadSectionName(input.name);
  if (!name) {
    return { status: "not_found" };
  }

  return db.transaction(
    (tx) => {
      const existing = getThreadSectionById(tx, input.id);
      if (!existing) {
        return { status: "not_found" };
      }

      if (existing.name === name) {
        return {
          status: "renamed",
          result: {
            id: existing.id,
            name: existing.name,
            updatedThreadCount: 0,
            updatedProjectCount: 0,
          },
        };
      }

      const duplicate = getThreadSectionByName(tx, name);
      if (duplicate && duplicate.id !== input.id) {
        return { status: "duplicate", section: duplicate };
      }

      tx.update(threadSections)
        .set({ name, updatedAt: Date.now() })
        .where(eq(threadSections.id, input.id))
        .run();
      notifyThreadSectionListChanged(notifier);
      return {
        status: "renamed",
        result: {
          id: input.id,
          name,
          updatedThreadCount: 0,
          updatedProjectCount: 0,
        },
      };
    },
    { behavior: "immediate" },
  );
}

export function deleteThreadSection(
  db: DbConnection,
  notifier: DbNotifier,
  input: DeleteThreadSectionInput,
): ThreadSectionMutationResult | null {
  return db.transaction(
    (tx) => {
      const section = getThreadSectionById(tx, input.id);
      if (!section) {
        return null;
      }

      const matchingThreads = tx
        .select({
          id: threads.id,
          projectId: threads.projectId,
        })
        .from(threads)
        .where(eq(threads.sectionId, input.id))
        .all();

      const sectionProjects = tx
        .select({ projectId: threadSectionProjects.projectId })
        .from(threadSectionProjects)
        .where(eq(threadSectionProjects.sectionId, input.id))
        .all();

      const now = Date.now();
      const affectedProjects = new Set<string>();
      tx.update(threads)
        .set({ sectionId: null, updatedAt: now })
        .where(eq(threads.sectionId, input.id))
        .run();
      for (const thread of matchingThreads) {
        affectedProjects.add(thread.projectId);
        notifier.notifyThread(thread.id, ["title-changed"], {
          projectId: thread.projectId,
        });
      }
      tx.delete(threadSectionProjects)
        .where(eq(threadSectionProjects.sectionId, input.id))
        .run();
      for (const row of sectionProjects) {
        tx.update(projects)
          .set({ updatedAt: now })
          .where(eq(projects.id, row.projectId))
          .run();
        notifier.notifyProject(row.projectId, ["project-updated"]);
      }

      tx.delete(threadSections).where(eq(threadSections.id, input.id)).run();
      notifyThreadSectionMutationProjects(notifier, affectedProjects);
      return {
        id: section.id,
        name: section.name,
        updatedThreadCount: matchingThreads.length,
        updatedProjectCount: sectionProjects.length,
      };
    },
    { behavior: "immediate" },
  );
}
