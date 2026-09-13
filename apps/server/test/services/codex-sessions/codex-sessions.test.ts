import { existsSync } from "node:fs";
import {
  appendFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  getThread,
  getThreadCodexLink,
  listEvents,
  listProjectSourcesByHost,
} from "@kaioken/db";
import { afterEach, describe, expect, it } from "vitest";
import { ApiError } from "../../../src/errors.js";
import {
  getCodexThreadLink,
  handoffCodexSession,
  importCodexSession,
  listCodexSessions,
  syncCodexSession,
} from "../../../src/services/codex-sessions/codex-sessions.js";
import { getLastProviderThreadId } from "../../../src/services/threads/thread-events.js";
import { reportNextEnvironmentAttachSuccess } from "../../helpers/commands.js";
import { installFakePersonalWorkspaceProvider } from "../../helpers/environment-provider.js";
import {
  seedEnvironment,
  seedHostSession,
  seedPrimaryHost,
  seedProjectWithSource,
  seedThread,
} from "../../helpers/seed.js";
import {
  withTestHarness,
  type TestAppHarness,
} from "../../helpers/test-app.js";

const fixtures = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../packages/codex-rollout/test/fixtures",
);
const MODERN_ID = "019ebb9f-83ed-74f0-ac0b-d0273ee7bad8";
const MODERN_RELATIVE =
  "sessions/2026/06/12/rollout-2026-06-12T21-37-33-019ebb9f-83ed-74f0-ac0b-d0273ee7bad8.jsonl";
const LEGACY_ID = "019c3721-b644-7491-aa8e-54c0c165307d";
const SUBAGENT_ID = "019f0000-0000-7000-8000-000000000001";
const PROJECT_PATH = "/Users/jsk/mythos";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function seedHomes(): Promise<{ shared: string; private: string }> {
  const root = await mkdtemp(join(tmpdir(), "kaioken-codex-sessions-"));
  roots.push(root);
  const shared = join(root, "codex");
  const privateHome = join(root, "kaioken-codex-home");
  const files: Record<string, string> = {
    [MODERN_RELATIVE]: "modern.jsonl",
    "archived_sessions/rollout-2026-02-07T19-04-42-019c3721-b644-7491-aa8e-54c0c165307d.jsonl":
      "legacy.jsonl",
    "sessions/2026/07/01/rollout-2026-07-01T00-00-00-019f0000-0000-7000-8000-000000000001.jsonl":
      "subagent.jsonl",
    "sessions/2026/09/01/rollout-2026-09-01T00-00-00-019f0000-0000-7000-8000-00000000abcd.jsonl":
      "kaioken.jsonl",
  };
  for (const [relative, fixture] of Object.entries(files)) {
    const target = join(shared, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(fixtures, fixture)));
  }
  await mkdir(join(privateHome, "sessions"), { recursive: true });
  return { shared, private: privateHome };
}

function seedLocalProject(harness: TestAppHarness) {
  const { host } = seedHostSession(harness.deps, { id: "host-codex-sessions" });
  seedPrimaryHost(harness.deps, host.id);
  const { project } = seedProjectWithSource(harness.deps, {
    hostId: host.id,
    path: PROJECT_PATH,
  });
  seedEnvironment(harness.deps, {
    hostId: host.id,
    projectId: project.id,
    path: PROJECT_PATH,
  });
  return { host, project };
}

async function waitForIdle(harness: TestAppHarness, threadId: string) {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const thread = getThread(harness.db, threadId);
    if (thread?.status === "idle") return thread;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Thread ${threadId} did not settle idle`);
}

function eventShapes(harness: TestAppHarness, threadId: string) {
  return listEvents(harness.db, { threadId }).map((row) => ({
    type: row.type,
    turnId: row.turnId,
    providerThreadId: row.providerThreadId,
    itemKind: row.itemKind,
  }));
}

describe("listCodexSessions", () => {
  it("lists top-level Codex sessions and marks the ones already imported", async () => {
    await withTestHarness(async (harness) => {
      const homes = await seedHomes();
      seedLocalProject(harness);
      const active = listCodexSessions(harness.deps, {
        includeArchived: false,
        homes,
      });
      expect(active.sessions.map((session) => session.id)).toEqual([MODERN_ID]);
      expect(active.sessions[0]).toMatchObject({
        cwd: PROJECT_PATH,
        firstPrompt: "Fix the failing test in src/app.ts",
        archived: false,
        importedThreadId: null,
      });
      const withArchived = listCodexSessions(harness.deps, {
        includeArchived: true,
        homes,
      });
      expect(
        withArchived.sessions.map((session) => [session.id, session.archived]),
      ).toEqual(
        expect.arrayContaining([
          [MODERN_ID, false],
          [LEGACY_ID, true],
        ]),
      );
      expect(withArchived.sessions).toHaveLength(2);

      const imported = await importCodexSession(harness.deps, {
        id: MODERN_ID,
        origin: "sdk",
        homes,
      });
      expect(
        listCodexSessions(harness.deps, { includeArchived: false, homes })
          .sessions[0]?.importedThreadId,
      ).toBe(imported.thread.id);
    });
  });
});

describe("importCodexSession", () => {
  it("creates an idle thread bound to the Codex session with its history", async () => {
    await withTestHarness(async (harness) => {
      const homes = await seedHomes();
      const { project } = seedLocalProject(harness);

      const outcome = await importCodexSession(harness.deps, {
        id: MODERN_ID,
        origin: "cli",
        homes,
      });
      expect(outcome.created).toBe(true);
      expect(outcome.importedTurns).toBe(2);
      expect(outcome.thread.projectId).toBe(project.id);
      expect(outcome.thread.providerId).toBe("codex");
      expect(outcome.thread.title).toBe("Fix the failing test in src/app.ts");

      const idle = await waitForIdle(harness, outcome.thread.id);
      expect(idle.environmentId).not.toBeNull();
      expect(getLastProviderThreadId(harness.deps, idle.id)).toBe(MODERN_ID);

      const shapes = eventShapes(harness, idle.id);
      const turnOne = "019ebb9f-923a-7530-9c4d-be001505bbaf";
      expect(shapes.slice(0, 13)).toEqual([
        {
          type: "thread/identity",
          turnId: null,
          providerThreadId: MODERN_ID,
          itemKind: null,
        },
        {
          type: "client/turn/requested",
          turnId: null,
          providerThreadId: null,
          itemKind: null,
        },
        {
          type: "turn/started",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: null,
        },
        {
          type: "turn/input/accepted",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: null,
        },
        {
          type: "item/completed",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: "reasoning",
        },
        {
          type: "item/completed",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: "commandExecution",
        },
        {
          type: "item/completed",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: "fileChange",
        },
        {
          type: "item/completed",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: "toolCall",
        },
        {
          type: "item/completed",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: "webSearch",
        },
        {
          type: "item/completed",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: "agentMessage",
        },
        {
          type: "turn/completed",
          turnId: turnOne,
          providerThreadId: MODERN_ID,
          itemKind: null,
        },
        {
          type: "client/turn/requested",
          turnId: null,
          providerThreadId: null,
          itemKind: null,
        },
        {
          type: "turn/started",
          turnId: "019ebb9f-a1c2-7d00-8a11-2f4c9e1b0aaa",
          providerThreadId: MODERN_ID,
          itemKind: null,
        },
      ]);
      expect(shapes.some((row) => row.type === "client/thread/start")).toBe(
        true,
      );
      expect(
        shapes.filter((row) => row.type === "client/turn/requested"),
      ).toHaveLength(3);
      const startRequest = listEvents(harness.db, { threadId: idle.id })
        .filter((row) => row.type === "client/turn/requested")
        .at(-1);
      expect(JSON.parse(startRequest?.data ?? "{}")).toMatchObject({
        input: [],
        target: { kind: "thread-start" },
      });
      const firstItem = listEvents(harness.db, { threadId: idle.id }).find(
        (row) => row.itemKind === "commandExecution",
      );
      expect(firstItem?.createdAt).toBe(Date.parse("2026-06-12T11:37:41.000Z"));

      expect(getThreadCodexLink(harness.db, idle.id)).toEqual({
        threadId: idle.id,
        sourceProviderThreadId: MODERN_ID,
        handoffState: null,
        sourceSyncedOrdinal: 19,
      });
      expect(existsSync(join(homes.private, MODERN_RELATIVE))).toBe(true);

      const again = await importCodexSession(harness.deps, {
        id: MODERN_ID,
        origin: "cli",
        homes,
      });
      expect(again.created).toBe(false);
      expect(again.thread.id).toBe(idle.id);
    });
  });

  it("rejects unknown and subagent sessions", async () => {
    await withTestHarness(async (harness) => {
      const homes = await seedHomes();
      seedLocalProject(harness);
      await expect(
        importCodexSession(harness.deps, { id: "nope", origin: "sdk", homes }),
      ).rejects.toMatchObject({
        status: 404,
        body: { code: "codex_session_not_found" },
      });
      await expect(
        importCodexSession(harness.deps, {
          id: SUBAGENT_ID,
          origin: "sdk",
          homes,
        }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  it("creates a project for an existing folder without one and falls back to personal", async () => {
    await withTestHarness(async (harness) => {
      const homes = await seedHomes();
      const { host } = seedHostSession(harness.deps, { id: "host-codex-new" });
      seedPrimaryHost(harness.deps, host.id);
      const folder = await mkdtemp(join(tmpdir(), "kaioken-codex-folder-"));
      roots.push(folder);
      const rollout = (
        await readFile(join(homes.shared, MODERN_RELATIVE), "utf8")
      )
        .replace(
          /"cwd": ?"\/Users\/jsk\/mythos"/g,
          `"cwd":${JSON.stringify(folder)}`,
        )
        .replace(
          /019ebb9f-83ed-74f0-ac0b-d0273ee7bad8/g,
          "019ebb9f-83ed-74f0-ac0b-d0273ee7ffff",
        );
      await writeFile(
        join(homes.shared, "sessions/2026/06/12/rollout-folder.jsonl"),
        rollout,
      );
      const outcome = await importCodexSession(harness.deps, {
        id: "019ebb9f-83ed-74f0-ac0b-d0273ee7ffff",
        origin: "sdk",
        homes,
      });
      expect(outcome.thread.projectId).not.toBe("proj_personal");
      await reportNextEnvironmentAttachSuccess(harness, outcome.thread.id);
      await waitForIdle(harness, outcome.thread.id);

      const missing = rollout
        .replace(
          JSON.stringify(folder),
          JSON.stringify(`/nonexistent/kaioken-codex-${Date.now()}`),
        )
        .replace(
          /019ebb9f-83ed-74f0-ac0b-d0273ee7ffff/g,
          "019ebb9f-83ed-74f0-ac0b-d0273ee7eeee",
        );
      await writeFile(
        join(homes.shared, "sessions/2026/06/12/rollout-missing.jsonl"),
        missing,
      );
      installFakePersonalWorkspaceProvider();
      const personal = await importCodexSession(harness.deps, {
        id: "019ebb9f-83ed-74f0-ac0b-d0273ee7eeee",
        origin: "sdk",
        homes,
      });
      expect(personal.thread.projectId).toBe("proj_personal");
      expect(
        listProjectSourcesByHost(harness.db, host.id).map(
          (source) => source.path,
        ),
      ).toEqual([folder]);
    });
  });
});

describe("handoff and sync", () => {
  it("copies the rollout to the shared home and pulls new Codex turns back", async () => {
    await withTestHarness(async (harness) => {
      const homes = await seedHomes();
      seedLocalProject(harness);
      const { thread } = await importCodexSession(harness.deps, {
        id: MODERN_ID,
        origin: "sdk",
        homes,
      });
      await waitForIdle(harness, thread.id);
      await rm(join(homes.shared, MODERN_RELATIVE));

      const handoff = handoffCodexSession(harness.deps, {
        threadId: thread.id,
        homes,
      });
      expect(handoff).toEqual({
        threadId: thread.id,
        providerThreadId: MODERN_ID,
        rolloutPath: join(homes.shared, MODERN_RELATIVE),
        command: `codex resume ${MODERN_ID}`,
      });
      expect(existsSync(handoff.rolloutPath)).toBe(true);
      expect(getCodexThreadLink(harness.deps, thread.id)).toMatchObject({
        providerThreadId: MODERN_ID,
        handoffState: "handed-off",
        sourceSyncedOrdinal: 19,
      });

      const unchanged = await syncCodexSession(harness.deps, {
        threadId: thread.id,
        homes,
      });
      expect(unchanged.appendedTurns).toBe(0);
      expect(
        getCodexThreadLink(harness.deps, thread.id).handoffState,
      ).toBeNull();

      const turnId = "019ebb9f-cccc-7d00-8a11-2f4c9e1b0bbb";
      const line = (ordinal: number, payload: unknown) =>
        `${JSON.stringify({
          timestamp: "2026-06-13T09:00:00.000Z",
          ordinal,
          type: "event_msg",
          payload,
        })}\n`;
      await appendFile(
        handoff.rolloutPath,
        line(20, { type: "task_started", turn_id: turnId }) +
          line(21, {
            type: "item_completed",
            turn_id: turnId,
            item: {
              type: "UserMessage",
              id: "item-20",
              content: [{ type: "text", text: "asked from the codex cli" }],
            },
          }) +
          line(22, {
            type: "item_completed",
            turn_id: turnId,
            item: {
              type: "AgentMessage",
              id: "item-21",
              content: [{ type: "Text", text: "answered from the codex cli" }],
            },
          }) +
          line(23, { type: "task_complete", turn_id: turnId }),
      );
      const synced = await syncCodexSession(harness.deps, {
        threadId: thread.id,
        homes,
      });
      expect(synced).toMatchObject({
        appendedTurns: 1,
        appendedEvents: 5,
        rolloutPath: join(homes.private, MODERN_RELATIVE),
      });
      const tail = eventShapes(harness, thread.id).slice(-5);
      expect(tail.map((row) => row.type)).toEqual([
        "client/turn/requested",
        "turn/started",
        "turn/input/accepted",
        "item/completed",
        "turn/completed",
      ]);
      expect(tail[1]?.turnId).toBe(turnId);
      expect(
        getCodexThreadLink(harness.deps, thread.id).sourceSyncedOrdinal,
      ).toBe(23);
      expect(
        (await readFile(join(homes.private, MODERN_RELATIVE), "utf8")).includes(
          "asked from the codex cli",
        ),
      ).toBe(true);
    });
  });

  it("refuses non-Codex, busy, and never-linked threads", async () => {
    await withTestHarness(async (harness) => {
      const homes = await seedHomes();
      const { project } = seedLocalProject(harness);
      const claude = seedThread(harness.deps, {
        projectId: project.id,
        providerId: "claude",
      });
      expect(() =>
        handoffCodexSession(harness.deps, { threadId: claude.id, homes }),
      ).toThrow(ApiError);
      await expect(
        syncCodexSession(harness.deps, { threadId: claude.id, homes }),
      ).rejects.toMatchObject({ body: { code: "codex_thread_required" } });

      const active = seedThread(harness.deps, {
        projectId: project.id,
        status: "active",
      });
      expect(() =>
        handoffCodexSession(harness.deps, { threadId: active.id, homes }),
      ).toThrow(
        expect.objectContaining({
          body: expect.objectContaining({ code: "thread_busy" }),
        }),
      );

      const unlinked = seedThread(harness.deps, { projectId: project.id });
      expect(() =>
        handoffCodexSession(harness.deps, { threadId: unlinked.id, homes }),
      ).toThrow(
        expect.objectContaining({
          body: expect.objectContaining({ code: "codex_session_unavailable" }),
        }),
      );
    });
  });
});
