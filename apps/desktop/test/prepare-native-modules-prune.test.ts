import { mkdir, mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const require = createRequire(import.meta.url);
const { prunePackagedNodeModules } =
  require("../scripts/prepare-native-modules.cjs") as {
    prunePackagedNodeModules: (dir: string) => Promise<string[]>;
  };

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function seed(files: Record<string, string>): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kaioken-prune-"));
  roots.push(root);
  for (const [relative, content] of Object.entries(files)) {
    const target = join(root, relative);
    await mkdir(join(target, ".."), { recursive: true });
    await writeFile(target, content);
  }
  return root;
}

async function listFiles(root: string): Promise<string[]> {
  const found: string[] = [];
  for (const entry of await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (entry.isFile()) {
      found.push(join(entry.parentPath, entry.name).slice(root.length + 1));
    }
  }
  return found.sort();
}

describe("prunePackagedNodeModules", () => {
  it("drops source maps, sqlite sources, foreign prebuilds, and drizzle snapshots but keeps runtime files", async () => {
    const root = await seed({
      "kaioken-app/server/dist/start-server.js": "",
      "kaioken-app/server/dist/start-server.js.map": "",
      "kaioken-app/server/dist/builtin-plugins/x/dist/server.js.map": "",
      "kaioken-app/server/dist/drizzle/0001_init.sql": "",
      "kaioken-app/server/dist/drizzle/meta/_journal.json": "",
      "kaioken-app/server/dist/drizzle/meta/0001_snapshot.json": "",
      "kaioken-app/src/index.ts": "",
      "kaioken-app/vitest.config.ts": "",
      "kaioken-app/package.json": "",
      "better-sqlite3/build/Release/better_sqlite3.node": "",
      "better-sqlite3/deps/sqlite3/sqlite3.c": "",
      "node-pty/prebuilds/darwin-arm64/pty.node": "",
      "node-pty/prebuilds/win32-x64/pty.node": "",
      "node-pty/prebuilds/linux-arm64/pty.node": "",
      "zod/src/index.ts": "",
      "zod/index.js": "",
      "other/lib/tsconfig.json": "",
    });
    const removed = await prunePackagedNodeModules(root);
    expect(removed.length).toBeGreaterThan(0);
    expect(await listFiles(root)).toEqual([
      "better-sqlite3/build/Release/better_sqlite3.node",
      "kaioken-app/package.json",
      "kaioken-app/server/dist/drizzle/0001_init.sql",
      "kaioken-app/server/dist/drizzle/meta/_journal.json",
      "kaioken-app/server/dist/start-server.js",
      "node-pty/prebuilds/darwin-arm64/pty.node",
      "other/lib/tsconfig.json",
      "zod/index.js",
    ]);
  });
});
