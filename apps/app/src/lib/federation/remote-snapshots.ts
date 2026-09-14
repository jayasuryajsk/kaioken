import { z } from "zod";
import type { SidebarBootstrapResponse } from "@kaioken/server-contract";
import { sidebarBootstrapResponseSchema } from "@kaioken/server-contract";

export const FEDERATION_SNAPSHOT_STORAGE_PREFIX =
  "kaioken.federation.snapshot.";
const MAX_SNAPSHOT_THREADS_PER_PROJECT = 30;

interface StoredSnapshot {
  fetchedAt: number;
  bootstrap: SidebarBootstrapResponse;
}

function boundSnapshot(
  bootstrap: SidebarBootstrapResponse,
): SidebarBootstrapResponse {
  const trim = <
    T extends {
      threads: SidebarBootstrapResponse["personalProject"]["threads"];
    },
  >(
    project: T,
  ): T => ({
    ...project,
    threads: [...project.threads]
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .slice(0, MAX_SNAPSHOT_THREADS_PER_PROJECT),
  });
  return {
    sections: bootstrap.sections,
    projects: bootstrap.projects.map(trim),
    personalProject: trim(bootstrap.personalProject),
  };
}

const parsedByHandle = new Map<
  string,
  { raw: string; snapshot: StoredSnapshot | null }
>();

export function readStoredSnapshot(handle: string): StoredSnapshot | null {
  try {
    const raw = window.localStorage.getItem(
      `${FEDERATION_SNAPSHOT_STORAGE_PREFIX}${handle}`,
    );
    if (raw === null) return null;
    const cached = parsedByHandle.get(handle);
    if (cached !== undefined && cached.raw === raw) return cached.snapshot;
    const snapshot = parseStoredSnapshot(raw);
    parsedByHandle.set(handle, { raw, snapshot });
    return snapshot;
  } catch {
    return null;
  }
}

const storedSnapshotSchema = z.object({
  fetchedAt: z.number(),
  bootstrap: sidebarBootstrapResponseSchema,
});

function parseStoredSnapshot(raw: string): StoredSnapshot | null {
  try {
    const parsed = storedSnapshotSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

export function writeStoredSnapshot(
  handle: string,
  snapshot: StoredSnapshot,
): void {
  try {
    window.localStorage.setItem(
      `${FEDERATION_SNAPSHOT_STORAGE_PREFIX}${handle}`,
      JSON.stringify({
        fetchedAt: snapshot.fetchedAt,
        bootstrap: boundSnapshot(snapshot.bootstrap),
      }),
    );
  } catch {
    return;
  }
}
