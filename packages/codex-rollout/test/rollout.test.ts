import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyRolloutBetweenHomes,
  findRolloutById,
  findRolloutsById,
  listRolloutFiles,
  mergeRolloutSummaries,
  parseRolloutFile,
  parseRolloutFiles,
  parseRolloutText,
  readRolloutLastOrdinal,
  readRolloutSummary,
  resolveCodexHomes,
  rolloutFirstPrompt,
  rolloutRelativePath,
} from "../src/index.js";

const fixtures = join(dirname(fileURLToPath(import.meta.url)), "fixtures");
const MODERN_ID = "019ebb9f-83ed-74f0-ac0b-d0273ee7bad8";
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function tempHome(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "codex-rollout-"));
  roots.push(root);
  return root;
}

async function seedHome(
  home: string,
  files: Record<string, string>,
): Promise<void> {
  for (const [relative, fixture] of Object.entries(files)) {
    const target = join(home, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, await readFile(join(fixtures, fixture)));
  }
}

describe("parseRolloutFile", () => {
  it("groups completed items by turn in ordinal order and tolerates unknown items", async () => {
    const rollout = await parseRolloutFile(join(fixtures, "modern.jsonl"));
    expect(rollout.format).toBe("modern");
    expect(rollout.meta).toEqual({
      id: MODERN_ID,
      sessionId: MODERN_ID,
      parentThreadId: null,
      cwd: "/Users/jsk/mythos",
      originator: "Codex Desktop",
      source: "vscode",
      timestamp: "2026-06-12T11:37:33.933Z",
      cliVersion: "0.132.0",
      model: "gpt-5.5",
      reasoningEffort: "medium",
      isSubagent: false,
    });
    expect(rollout.lastOrdinal).toBe(19);
    expect(rollout.turns.map((turn) => turn.turnId)).toEqual([
      "019ebb9f-923a-7530-9c4d-be001505bbaf",
      "019ebb9f-a1c2-7d00-8a11-2f4c9e1b0aaa",
    ]);
    const [first, second] = rollout.turns;
    expect(first?.startedAt).toBe("2026-06-12T11:37:37.862Z");
    expect(first?.skippedItemKinds).toEqual(["SubAgentActivity"]);
    expect(first?.items.map((entry) => entry.ordinal)).toEqual([
      4, 6, 7, 8, 9, 10, 12,
    ]);
    expect(first?.items.map((entry) => entry.item)).toEqual([
      {
        type: "userMessage",
        id: "item-1",
        content: [
          { type: "text", text: "Fix the failing test in src/app.ts" },
          { type: "localImage", path: "/tmp/shot.png" },
        ],
      },
      {
        type: "reasoning",
        id: "item-2",
        summary: ["Looking at the test"],
        content: [],
      },
      {
        type: "commandExecution",
        id: "item-3",
        command: "/bin/zsh -lc 'pnpm test -- src/app.test.ts'",
        cwd: "/Users/jsk/mythos",
        status: "completed",
        approvalStatus: null,
        aggregatedOutput: "1 passed\n",
        exitCode: 0,
        durationMs: 1500,
      },
      {
        type: "fileChange",
        id: "item-4",
        changes: [
          {
            path: "/Users/jsk/mythos/src/app.ts",
            kind: "update",
            diff: "@@ -1 +1 @@\n-a\n+b\n",
          },
          {
            path: "/Users/jsk/mythos/NEW.md",
            kind: "add",
            diff: "+hello\n+world",
          },
        ],
        status: "completed",
        approvalStatus: null,
      },
      {
        type: "toolCall",
        id: "item-5",
        server: "github",
        tool: "get_pr",
        arguments: { number: 7 },
        status: "failed",
        error: "not found",
        durationMs: 20,
      },
      {
        type: "webSearch",
        id: "item-6",
        queries: ["vitest mocking", "vitest vi.fn"],
        resultText: null,
      },
      { type: "agentMessage", id: "item-8", text: "Fixed the test." },
    ]);
    expect(second?.items.map((entry) => entry.item.type)).toEqual([
      "userMessage",
      "agentMessage",
    ]);
    expect(rolloutFirstPrompt(rollout)).toBe(
      "Fix the failing test in src/app.ts",
    );
  });

  it("falls back to response items for rollouts that predate completed items", async () => {
    const rollout = await parseRolloutFile(join(fixtures, "legacy.jsonl"));
    expect(rollout.format).toBe("legacy");
    expect(rollout.meta.model).toBe("gpt-5.3-codex");
    expect(rollout.turns).toHaveLength(1);
    const items = rollout.turns[0]?.items.map((entry) => entry.item) ?? [];
    expect(items.map((item) => item.type)).toEqual([
      "userMessage",
      "reasoning",
      "commandExecution",
      "agentMessage",
      "webSearch",
    ]);
    expect(items[0]).toEqual({
      type: "userMessage",
      id: "item-1",
      content: [{ type: "text", text: "yo\n" }],
    });
    expect(items[2]).toEqual({
      type: "commandExecution",
      id: "call_1",
      command: "ls -la",
      cwd: "",
      status: "completed",
      approvalStatus: null,
      aggregatedOutput: "total 0\n",
    });
  });

  it("detects subagent rollouts from the source or the parent thread", () => {
    const fromSource = parseRolloutText(
      JSON.stringify({
        timestamp: "2026-07-01T00:00:00.000Z",
        ordinal: 0,
        type: "session_meta",
        payload: {
          id: "a",
          timestamp: "2026-07-01T00:00:00.000Z",
          cwd: "/x",
          originator: "Codex Desktop",
          source: { subagent: { other: "guardian" } },
        },
      }),
    );
    expect(fromSource.meta.isSubagent).toBe(true);
    expect(fromSource.meta.source).toBe("subagent:guardian");
    const fromParent = parseRolloutText(
      JSON.stringify({
        type: "session_meta",
        payload: { id: "a", parent_thread_id: "b", cwd: "/x", originator: "x" },
      }),
    );
    expect(fromParent.meta.isSubagent).toBe(true);
    const selfParent = parseRolloutText(
      JSON.stringify({
        type: "session_meta",
        payload: { id: "a", parent_thread_id: "a", cwd: "/x", originator: "x" },
      }),
    );
    expect(selfParent.meta.isSubagent).toBe(false);
  });

  it("rejects text without a session header and skips unparsable lines", () => {
    expect(() => parseRolloutText("not json\n")).toThrow(/session_meta/);
    const rollout = parseRolloutText(
      [
        "garbage",
        JSON.stringify({
          type: "session_meta",
          payload: { id: "a", cwd: "/x", originator: "x" },
        }),
        JSON.stringify({
          type: "event_msg",
          ordinal: 5,
          payload: { type: "item_completed", turn_id: "t", item: { nope: 1 } },
        }),
        JSON.stringify({
          type: "event_msg",
          ordinal: 6,
          payload: {
            type: "item_completed",
            turn_id: "t",
            item: {
              type: "AgentMessage",
              id: "m",
              content: [{ type: "Text", text: "hi" }],
            },
          },
        }),
      ].join("\n"),
    );
    expect(rollout.turns[0]?.skippedItemKinds).toEqual(["malformed"]);
    expect(rollout.turns[0]?.items).toHaveLength(1);
    expect(rollout.lastOrdinal).toBe(6);
  });
});

describe("parseRolloutFiles", () => {
  it("merges a session split across rollout files in ordinal order", async () => {
    const rollout = await parseRolloutFiles([
      join(fixtures, "modern-continued.jsonl"),
      join(fixtures, "modern.jsonl"),
    ]);
    expect(rollout.meta.id).toBe(MODERN_ID);
    expect(rollout.meta.cliVersion).toBe("0.132.0");
    expect(rollout.meta.reasoningEffort).toBe("high");
    expect(rollout.turns.map((turn) => turn.turnId)).toEqual([
      "019ebb9f-923a-7530-9c4d-be001505bbaf",
      "019ebb9f-a1c2-7d00-8a11-2f4c9e1b0aaa",
      "019ebb9f-dddd-7d00-8a11-2f4c9e1b0ccc",
    ]);
    expect(rollout.lastOrdinal).toBe(24);
    const summaries = mergeRolloutSummaries([
      readRolloutSummary(join(fixtures, "modern-continued.jsonl"), {
        archived: false,
      })!,
      readRolloutSummary(join(fixtures, "modern.jsonl"), { archived: false })!,
    ]);
    expect(summaries).toHaveLength(1);
    expect(summaries[0]).toMatchObject({
      id: MODERN_ID,
      createdAt: "2026-06-12T11:37:33.933Z",
      firstPrompt: "Fix the failing test in src/app.ts",
      path: join(fixtures, "modern-continued.jsonl"),
    });
  });
});

describe("readRolloutSummary", () => {
  it("reads the header, first prompt, and archive flag without parsing the whole file", () => {
    const summary = readRolloutSummary(join(fixtures, "modern.jsonl"), {
      archived: true,
    });
    expect(summary).toMatchObject({
      id: MODERN_ID,
      cwd: "/Users/jsk/mythos",
      originator: "Codex Desktop",
      source: "vscode",
      createdAt: "2026-06-12T11:37:33.933Z",
      firstPrompt: "Fix the failing test in src/app.ts",
      isSubagent: false,
      archived: true,
    });
    expect(
      readRolloutSummary(join(fixtures, "subagent.jsonl"), { archived: false }),
    ).toMatchObject({ isSubagent: true, source: "subagent:guardian" });
    expect(readRolloutLastOrdinal(join(fixtures, "modern.jsonl"))).toBe(19);
  });
});

describe("homes", () => {
  it("prefers the private home only when it exists", async () => {
    const home = await tempHome();
    const withoutPrivate = resolveCodexHomes({ env: {}, homeDir: home });
    expect(withoutPrivate).toEqual({
      shared: join(home, ".codex"),
      private: join(home, ".codex"),
    });
    await mkdir(join(home, ".kaioken", "codex-home"), { recursive: true });
    const withPrivate = resolveCodexHomes({
      env: { CODEX_HOME: join(home, "custom-codex") },
      homeDir: home,
    });
    expect(withPrivate).toEqual({
      shared: join(home, "custom-codex"),
      private: join(home, ".kaioken", "codex-home"),
    });
  });

  it("lists, finds, and copies rollouts by their header id", async () => {
    const shared = join(await tempHome(), ".codex");
    const privateHome = join(await tempHome(), "codex-home");
    await seedHome(shared, {
      "sessions/2026/06/12/rollout-2026-06-12T21-37-33-019ebb9f-83ed-74f0-ac0b-d0273ee7bad8.jsonl":
        "modern.jsonl",
      "archived_sessions/rollout-2026-02-07T19-04-42-019c3721-b644-7491-aa8e-54c0c165307d.jsonl":
        "legacy.jsonl",
      "sessions/2026/07/01/rollout-renamed.jsonl": "subagent.jsonl",
    });
    expect(listRolloutFiles(shared, { includeArchived: false })).toHaveLength(
      2,
    );
    expect(
      listRolloutFiles(shared, { includeArchived: true }).filter(
        (file) => file.archived,
      ),
    ).toHaveLength(1);
    const found = findRolloutById(shared, MODERN_ID);
    expect(found?.archived).toBe(false);
    await seedHome(shared, {
      "sessions/2026/06/13/rollout-2026-06-13T08-00-00-019ebb9f-83ed-74f0-ac0b-d0273ee7bad8_next.jsonl":
        "modern-continued.jsonl",
    });
    expect(
      findRolloutsById(shared, MODERN_ID).map((file) => file.path),
    ).toEqual([
      found!.path,
      join(
        shared,
        "sessions/2026/06/13/rollout-2026-06-13T08-00-00-019ebb9f-83ed-74f0-ac0b-d0273ee7bad8_next.jsonl",
      ),
    ]);
    expect(
      findRolloutById(shared, "019f0000-0000-7000-8000-000000000001")?.path,
    ).toContain("rollout-renamed.jsonl");
    expect(findRolloutById(shared, "missing")).toBeNull();
    const relative = rolloutRelativePath(shared, found!.path);
    expect(relative).toBe(
      "sessions/2026/06/12/rollout-2026-06-12T21-37-33-019ebb9f-83ed-74f0-ac0b-d0273ee7bad8.jsonl",
    );
    const copied = copyRolloutBetweenHomes({
      sourceHome: shared,
      sourcePath: found!.path,
      targetHome: privateHome,
    });
    expect(copied).toBe(join(privateHome, relative));
    expect(findRolloutById(privateHome, MODERN_ID)?.path).toBe(copied);
    expect(() => rolloutRelativePath(shared, "/elsewhere/x.jsonl")).toThrow(
      /outside/,
    );
  });
});
