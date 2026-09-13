import Database from "better-sqlite3";
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
  setThreadCodexLink,
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
import { registerHostRpcResponder } from "../../helpers/host-rpc.js";
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

describe("listCodexSessions with Codex's state database", () => {
  it("uses Codex's names, pins, sections, and archived flags", async () => {
    await withTestHarness(async (harness) => {
      const homes = await seedHomes();
      seedLocalProject(harness);
      const state = new Database(join(homes.shared, "state_5.sqlite"));
      state.exec(`
        CREATE TABLE thread_sections (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE projects (id TEXT PRIMARY KEY, name TEXT NOT NULL);
        CREATE TABLE threads (
          id TEXT PRIMARY KEY, rollout_path TEXT NOT NULL, cwd TEXT NOT NULL,
          title TEXT NOT NULL, first_user_message TEXT NOT NULL DEFAULT '',
          archived INTEGER NOT NULL DEFAULT 0, is_pinned INTEGER NOT NULL DEFAULT 0,
          name TEXT, thread_section_id TEXT, project_id TEXT, agent_role TEXT,
          created_at_ms INTEGER, updated_at_ms INTEGER, recency_at_ms INTEGER
        );
        INSERT INTO thread_sections VALUES ('sec', 'Work');
      `);
      state
        .prepare(
          "INSERT INTO threads (id, rollout_path, cwd, title, archived, is_pinned, name, thread_section_id) VALUES (?, '', ?, 'first', ?, ?, ?, ?)",
        )
        .run(MODERN_ID, PROJECT_PATH, 1, 1, "Green CI", "sec");
      state.close();

      expect(
        listCodexSessions(harness.deps, { includeArchived: false, homes })
          .sessions,
      ).toHaveLength(0);
      const listed = listCodexSessions(harness.deps, {
        includeArchived: true,
        homes,
      }).sessions.find((session) => session.id === MODERN_ID);
      expect(listed).toMatchObject({
        name: "Green CI",
        pinned: true,
        section: "Work",
        archived: true,
        firstPrompt: "Fix the failing test in src/app.ts",
      });

      const imported = await importCodexSession(harness.deps, {
        id: MODERN_ID,
        origin: "sdk",
        homes,
      });
      expect(imported.thread.title).toBe("Green CI");
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

      const handoff = await handoffCodexSession(harness.deps, {
        threadId: thread.id,
        homes,
      });
      expect(handoff).toEqual({
        threadId: thread.id,
        providerThreadId: MODERN_ID,
        rolloutPath: join(homes.shared, MODERN_RELATIVE),
        command: `codex resume ${MODERN_ID}`,
        hostId: "host-codex-sessions",
        hostName: "Test Host",
        hostIsServer: true,
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

  it("runs the handoff and sync on the thread's own machine when it is not the server", async () => {
    await withTestHarness(async (harness) => {
      const homes = await seedHomes();
      seedLocalProject(harness);
      const remote = seedHostSession(harness.deps, {
        id: "host-remote",
        name: "Mac mini",
      });
      const { project } = seedProjectWithSource(harness.deps, {
        hostId: remote.host.id,
        path: "/Users/me/on-the-mini",
      });
      const environment = seedEnvironment(harness.deps, {
        hostId: remote.host.id,
        projectId: project.id,
        path: "/Users/me/on-the-mini",
      });
      const thread = seedThread(harness.deps, {
        projectId: project.id,
        environmentId: environment.id,
      });
      setThreadCodexLink(harness.db, {
        threadId: thread.id,
        sourceProviderThreadId: MODERN_ID,
        handoffState: null,
        sourceSyncedOrdinal: null,
      });
      const cliTurnId = "019ebb9f-dddd-7d00-8a11-2f4c9e1b0ccc";
      const cliLine = (ordinal: number, payload: unknown) =>
        `${JSON.stringify({
          timestamp: "2026-06-13T09:00:00.000Z",
          ordinal,
          type: "event_msg",
          payload,
        })}\n`;
      const remoteRollout =
        (await readFile(join(fixtures, "modern.jsonl"), "utf8")) +
        cliLine(20, { type: "task_started", turn_id: cliTurnId }) +
        cliLine(21, {
          type: "item_completed",
          turn_id: cliTurnId,
          item: {
            type: "UserMessage",
            id: "item-30",
            content: [{ type: "text", text: "asked on the mini" }],
          },
        }) +
        cliLine(22, {
          type: "item_completed",
          turn_id: cliTurnId,
          item: {
            type: "AgentMessage",
            id: "item-31",
            content: [{ type: "Text", text: "answered on the mini" }],
          },
        }) +
        cliLine(23, { type: "task_complete", turn_id: cliTurnId });
      const remotePrivate = `/Users/me/.kaioken/codex-home/${MODERN_RELATIVE}`;
      const remoteShared = `/Users/me/.codex/${MODERN_RELATIVE}`;
      const responder = registerHostRpcResponder(harness, {
        hostId: remote.host.id,
        sessionId: remote.session.id,
        handle(request) {
          const command = request.command;
          switch (command.type) {
            case "codex.rollouts.locate":
              return {
                ok: true,
                result: {
                  rollouts: {
                    home: "private",
                    paths: [remotePrivate],
                    lastOrdinal: 19,
                  },
                },
              };
            case "codex.rollouts.copy":
              return {
                ok: true,
                result: {
                  copied: {
                    paths: [
                      command.to === "shared" ? remoteShared : remotePrivate,
                    ],
                    lastOrdinal: 19,
                  },
                },
              };
            case "codex.rollouts.read":
              return {
                ok: true,
                result: {
                  rollouts: {
                    paths: [remoteShared],
                    contents: [remoteRollout],
                    lastOrdinal: 23,
                  },
                },
              };
            default:
              return {
                ok: false,
                errorCode: "unexpected",
                errorMessage: `unexpected ${command.type}`,
              };
          }
        },
      });

      const handoff = await handoffCodexSession(harness.deps, {
        threadId: thread.id,
        homes,
      });
      expect(handoff).toEqual({
        threadId: thread.id,
        providerThreadId: MODERN_ID,
        rolloutPath: remoteShared,
        command: `codex resume ${MODERN_ID}`,
        hostId: remote.host.id,
        hostName: "Mac mini",
        hostIsServer: false,
      });
      expect(existsSync(join(homes.shared, MODERN_RELATIVE))).toBe(true);
      expect(getCodexThreadLink(harness.deps, thread.id)).toMatchObject({
        handoffState: "handed-off",
        sourceSyncedOrdinal: 19,
      });

      const synced = await syncCodexSession(harness.deps, {
        threadId: thread.id,
        homes,
      });
      expect(synced).toMatchObject({
        appendedTurns: 1,
        rolloutPath: remotePrivate,
      });
      expect(
        eventShapes(harness, thread.id).filter(
          (row) => row.type === "turn/started",
        ),
      ).toHaveLength(1);
      expect(
        getCodexThreadLink(harness.deps, thread.id).sourceSyncedOrdinal,
      ).toBe(23);
      expect(
        getCodexThreadLink(harness.deps, thread.id).handoffState,
      ).toBeNull();
      expect(
        responder.requests.map((request) => {
          const command = request.command;
          return command.type === "codex.rollouts.copy"
            ? `${command.type}:${command.from}->${command.to}`
            : command.type;
        }),
      ).toEqual([
        "codex.rollouts.locate",
        "codex.rollouts.copy:private->shared",
        "codex.rollouts.read",
        "codex.rollouts.copy:shared->private",
      ]);
      responder.unregister();
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
      await expect(
        handoffCodexSession(harness.deps, { threadId: claude.id, homes }),
      ).rejects.toBeInstanceOf(ApiError);
      await expect(
        syncCodexSession(harness.deps, { threadId: claude.id, homes }),
      ).rejects.toMatchObject({ body: { code: "codex_thread_required" } });

      const active = seedThread(harness.deps, {
        projectId: project.id,
        status: "active",
      });
      await expect(
        handoffCodexSession(harness.deps, { threadId: active.id, homes }),
      ).rejects.toMatchObject({ body: { code: "thread_busy" } });

      const unlinked = seedThread(harness.deps, { projectId: project.id });
      await expect(
        handoffCodexSession(harness.deps, { threadId: unlinked.id, homes }),
      ).rejects.toMatchObject({ body: { code: "codex_session_unavailable" } });
    });
  });
});
