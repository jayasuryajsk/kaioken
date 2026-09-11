import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  isRolloutFromOriginator,
  preparePrivateCodexHome,
  resolvePrivateCodexHome,
} from "./private-codex-home.js";

let tempRoot: string;
let sharedHome: string;
let privateHome: string;

function writeRollout(
  directory: string,
  name: string,
  originator: string,
): string {
  fs.mkdirSync(directory, { recursive: true });
  const filePath = path.join(directory, name);
  fs.writeFileSync(
    filePath,
    `${JSON.stringify({
      type: "session_meta",
      payload: { id: name, originator, source: "vscode" },
    })}\n${JSON.stringify({ type: "response_item", payload: {} })}\n`,
  );
  return filePath;
}

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "codex-private-home-"));
  sharedHome = path.join(tempRoot, "shared");
  privateHome = path.join(tempRoot, "private");
  fs.mkdirSync(sharedHome, { recursive: true });
  fs.writeFileSync(path.join(sharedHome, "auth.json"), "{}");
  fs.writeFileSync(path.join(sharedHome, "config.toml"), 'model = "x"\n');
  fs.mkdirSync(path.join(sharedHome, "plugins", "cache"), { recursive: true });
  fs.writeFileSync(path.join(sharedHome, "memories_1.sqlite"), "");
  fs.writeFileSync(path.join(sharedHome, "memories_1.sqlite-wal"), "");
  fs.writeFileSync(path.join(sharedHome, "state_5.sqlite"), "");
  fs.writeFileSync(path.join(sharedHome, "history.jsonl"), "");
  fs.writeFileSync(path.join(sharedHome, ".sandbox_migration"), "1");
});

afterEach(() => {
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

describe("resolvePrivateCodexHome", () => {
  it("lives under the kaioken data directory", () => {
    expect(resolvePrivateCodexHome("/Users/me")).toBe(
      path.join("/Users/me", ".kaioken", "codex-home"),
    );
  });
});

describe("preparePrivateCodexHome", () => {
  it("links shared credentials, config, plugins, and memories but keeps session state private", () => {
    const result = preparePrivateCodexHome({ sharedHome, privateHome });

    expect(result.linked.sort()).toEqual([
      "auth.json",
      "config.toml",
      "memories_1.sqlite",
      "memories_1.sqlite-wal",
      "plugins",
    ]);
    expect(fs.readlinkSync(path.join(privateHome, "auth.json"))).toBe(
      path.join(sharedHome, "auth.json"),
    );
    expect(fs.existsSync(path.join(privateHome, "state_5.sqlite"))).toBe(false);
    expect(fs.existsSync(path.join(privateHome, "history.jsonl"))).toBe(false);
    expect(fs.statSync(path.join(privateHome, "sessions")).isDirectory()).toBe(
      true,
    );
    expect(
      fs
        .lstatSync(path.join(privateHome, ".sandbox_migration"))
        .isSymbolicLink(),
    ).toBe(false);
    expect(
      fs.readFileSync(path.join(privateHome, ".sandbox_migration"), "utf8"),
    ).toBe("1");
  });

  it("moves only kaioken rollouts out of the shared session directories, once", () => {
    const kaiokenRollout = writeRollout(
      path.join(sharedHome, "sessions", "2026", "09", "11"),
      "rollout-kaioken.jsonl",
      "kaioken",
    );
    const desktopRollout = writeRollout(
      path.join(sharedHome, "sessions", "2026", "09", "11"),
      "rollout-desktop.jsonl",
      "Codex Desktop",
    );
    const archivedRollout = writeRollout(
      path.join(sharedHome, "archived_sessions"),
      "rollout-archived.jsonl",
      "kaioken",
    );

    expect(
      preparePrivateCodexHome({ sharedHome, privateHome }).migratedRollouts,
    ).toBe(2);
    expect(fs.existsSync(kaiokenRollout)).toBe(false);
    expect(fs.existsSync(desktopRollout)).toBe(true);
    expect(fs.existsSync(archivedRollout)).toBe(false);
    expect(
      fs.existsSync(
        path.join(
          privateHome,
          "sessions",
          "2026",
          "09",
          "11",
          "rollout-kaioken.jsonl",
        ),
      ),
    ).toBe(true);
    expect(
      fs.existsSync(
        path.join(privateHome, "archived_sessions", "rollout-archived.jsonl"),
      ),
    ).toBe(true);

    writeRollout(
      path.join(sharedHome, "sessions", "2026", "09", "12"),
      "rollout-later.jsonl",
      "kaioken",
    );
    const again = preparePrivateCodexHome({ sharedHome, privateHome });
    expect(again.migratedRollouts).toBe(0);
    expect(again.linked).toEqual([]);
  });

  it("leaves an existing private file alone instead of replacing it with a link", () => {
    fs.mkdirSync(privateHome, { recursive: true });
    fs.writeFileSync(path.join(privateHome, "config.toml"), "private = true\n");

    preparePrivateCodexHome({ sharedHome, privateHome });

    expect(
      fs.lstatSync(path.join(privateHome, "config.toml")).isSymbolicLink(),
    ).toBe(false);
    expect(fs.readFileSync(path.join(privateHome, "config.toml"), "utf8")).toBe(
      "private = true\n",
    );
  });

  it("does nothing when the private home is the shared home", () => {
    expect(
      preparePrivateCodexHome({ sharedHome, privateHome: sharedHome }),
    ).toEqual({ linked: [], migratedRollouts: 0 });
    expect(fs.existsSync(path.join(sharedHome, "sessions"))).toBe(false);
  });

  it("recognises rollouts by the originator in their session header", () => {
    const rollout = writeRollout(
      path.join(tempRoot, "rollouts"),
      "rollout.jsonl",
      "kaioken",
    );
    expect(isRolloutFromOriginator(rollout, "kaioken")).toBe(true);
    expect(isRolloutFromOriginator(rollout, "Codex Desktop")).toBe(false);
    expect(
      isRolloutFromOriginator(path.join(tempRoot, "missing.jsonl"), "kaioken"),
    ).toBe(false);
  });
});
