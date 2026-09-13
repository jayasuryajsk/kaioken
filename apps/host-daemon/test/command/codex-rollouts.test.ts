import fs from "node:fs/promises";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  copyCodexRollouts,
  locateCodexRollouts,
  readCodexRollouts,
} from "../../src/command-handlers/codex-rollouts.js";
import { cleanupTempDirs, makeTempDir } from "./dispatch-helpers.js";

afterEach(cleanupTempDirs);

const SESSION_ID = "019ebb9f-83ed-74f0-ac0b-d0273ee7bad8";
const RELATIVE = `sessions/2026/06/12/rollout-2026-06-12T21-37-33-${SESSION_ID}.jsonl`;

function line(ordinal: number, type: string, payload: unknown): string {
  return `${JSON.stringify({
    timestamp: "2026-06-12T21:37:33.000Z",
    ordinal,
    type,
    payload,
  })}\n`;
}

async function seedHomes(): Promise<{ shared: string; private: string }> {
  const root = await makeTempDir("kaioken-codex-rollouts-");
  const homes = {
    shared: path.join(root, "codex"),
    private: path.join(root, "kaioken-codex-home"),
  };
  const rollout = path.join(homes.private, RELATIVE);
  await fs.mkdir(path.dirname(rollout), { recursive: true });
  await fs.writeFile(
    rollout,
    line(0, "session_meta", {
      id: SESSION_ID,
      timestamp: "2026-06-12T21:37:33.000Z",
      cwd: "/repo",
      originator: "codex_cli_rs",
      cli_version: "0.1.0",
      source: "cli",
    }) + line(1, "event_msg", { type: "task_started", turn_id: "turn-1" }),
  );
  await fs.mkdir(path.join(homes.shared, "sessions"), { recursive: true });
  return homes;
}

describe("codex rollout commands", () => {
  it("locates rollouts in the requested homes and reports the last ordinal", async () => {
    const homes = await seedHomes();
    expect(
      await locateCodexRollouts(
        {
          type: "codex.rollouts.locate",
          providerThreadId: SESSION_ID,
          homes: ["private", "shared"],
        },
        homes,
      ),
    ).toEqual({
      rollouts: {
        home: "private",
        paths: [path.join(homes.private, RELATIVE)],
        lastOrdinal: 1,
      },
    });
    expect(
      await locateCodexRollouts(
        {
          type: "codex.rollouts.locate",
          providerThreadId: SESSION_ID,
          homes: ["shared"],
        },
        homes,
      ),
    ).toEqual({ rollouts: null });
    expect(
      await locateCodexRollouts(
        {
          type: "codex.rollouts.locate",
          providerThreadId: "nope",
          homes: ["private", "shared"],
        },
        homes,
      ),
    ).toEqual({ rollouts: null });
  });

  it("copies rollouts between homes keeping the relative path", async () => {
    const homes = await seedHomes();
    expect(
      await copyCodexRollouts(
        {
          type: "codex.rollouts.copy",
          providerThreadId: SESSION_ID,
          from: "private",
          to: "shared",
        },
        homes,
      ),
    ).toEqual({
      copied: { paths: [path.join(homes.shared, RELATIVE)], lastOrdinal: 1 },
    });
    expect(
      await fs.readFile(path.join(homes.shared, RELATIVE), "utf8"),
    ).toContain(SESSION_ID);
    expect(
      await copyCodexRollouts(
        {
          type: "codex.rollouts.copy",
          providerThreadId: "nope",
          from: "private",
          to: "shared",
        },
        homes,
      ),
    ).toEqual({ copied: null });
  });

  it("reads rollout text from a home", async () => {
    const homes = await seedHomes();
    expect(
      await readCodexRollouts(
        {
          type: "codex.rollouts.read",
          providerThreadId: SESSION_ID,
          home: "shared",
        },
        homes,
      ),
    ).toEqual({ rollouts: null });
    const read = await readCodexRollouts(
      {
        type: "codex.rollouts.read",
        providerThreadId: SESSION_ID,
        home: "private",
      },
      homes,
    );
    expect(read.rollouts?.paths).toEqual([path.join(homes.private, RELATIVE)]);
    expect(read.rollouts?.contents[0]).toContain('"task_started"');
    expect(read.rollouts?.lastOrdinal).toBe(1);
  });
});
