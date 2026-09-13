import Database from "better-sqlite3";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  findCodexStateDatabase,
  readCodexStateThread,
  readCodexStateThreads,
} from "../src/state.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function home(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codex-state-"));
  roots.push(root);
  return root;
}

function seedFull(file: string): void {
  const db = new Database(file);
  db.exec(`
    CREATE TABLE thread_sections (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
    CREATE TABLE threads (
      id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL,
      title TEXT NOT NULL, first_user_message TEXT NOT NULL DEFAULT '',
      archived INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0,
      name TEXT, thread_section_id TEXT, project_id TEXT, agent_role TEXT,
      created_at_ms INTEGER, updated_at_ms INTEGER, recency_at_ms INTEGER
    );
    INSERT INTO thread_sections VALUES ('sec1', 'Work');
    INSERT INTO projects VALUES ('proj1', 'Kaioken');
    INSERT INTO threads VALUES
      ('a', '/r/a.jsonl', '/repo', 'fix the tests', 'fix the tests', 0, 1,
       'Green CI', 'sec1', 'proj1', NULL, 1, 2, 3),
      ('b', '/r/b.jsonl', '/repo', 'untitled', '', 1, 0,
       '   ', NULL, NULL, NULL, NULL, NULL, NULL),
      ('c', '/r/c.jsonl', '/repo', 'explore', '', 0, 0,
       NULL, NULL, NULL, 'explorer', NULL, NULL, NULL);
  `);
  db.close();
}

describe("readCodexStateThreads", () => {
  it("picks the newest state database and maps names, flags, and joins", async () => {
    const dir = await home();
    await writeFile(join(dir, "state_4.sqlite"), "");
    seedFull(join(dir, "state_5.sqlite"));
    expect(findCodexStateDatabase(dir)).toBe(join(dir, "state_5.sqlite"));
    const threads = readCodexStateThreads(dir);
    expect(threads.get("a")).toEqual({
      id: "a",
      rolloutPath: "/r/a.jsonl",
      cwd: "/repo",
      name: "Green CI",
      title: "fix the tests",
      firstUserMessage: "fix the tests",
      archived: false,
      pinned: true,
      section: "Work",
      project: "Kaioken",
      createdAtMs: 1,
      updatedAtMs: 2,
      recencyAtMs: 3,
      agentRole: null,
    });
    expect(threads.get("b")).toMatchObject({
      name: null,
      archived: true,
      pinned: false,
      section: null,
    });
    expect(threads.get("c")?.agentRole).toBe("explorer");
    expect(readCodexStateThread(dir, "b")?.title).toBe("untitled");
    expect(readCodexStateThread(dir, "zzz")).toBeNull();
  });

  it("falls back to the columns older Codex versions have", async () => {
    const dir = await home();
    const db = new Database(join(dir, "state_2.sqlite"));
    db.exec(`
      CREATE TABLE threads (id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL,
        cwd TEXT NOT NULL, title TEXT NOT NULL, archived INTEGER NOT NULL);
      INSERT INTO threads VALUES ('old', '/r/old.jsonl', '/repo', 'legacy', 1);
    `);
    db.close();
    expect(readCodexStateThread(dir, "old")).toMatchObject({
      name: null,
      title: "legacy",
      archived: true,
      pinned: false,
    });
  });

  it("returns nothing when there is no database or it is unreadable", async () => {
    const dir = await home();
    expect(readCodexStateThreads(dir).size).toBe(0);
    await writeFile(join(dir, "state_9.sqlite"), "not a database");
    expect(readCodexStateThreads(dir).size).toBe(0);
    expect(readCodexStateThread(join(dir, "missing"), "a")).toBeNull();
  });
});
