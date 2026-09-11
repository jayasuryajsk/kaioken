import {
  mkdir,
  mkdtemp,
  readlink,
  rm,
  writeFile,
  lstat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  prepareWorktreeDependencies,
  REPO_SETUP_SCRIPT_NAME,
} from "./dependencies.js";

const roots: string[] = [];

async function makeRoot(): Promise<{ source: string; target: string }> {
  const root = await mkdtemp(join(tmpdir(), "kaioken-worktree-deps-"));
  roots.push(root);
  const source = join(root, "source");
  const target = join(root, "target");
  await mkdir(source, { recursive: true });
  await mkdir(target, { recursive: true });
  return { source, target };
}

async function isSymlinkTo(link: string, expected: string): Promise<boolean> {
  const stats = await lstat(link);
  return stats.isSymbolicLink() && (await readlink(link)) === expected;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("prepareWorktreeDependencies", () => {
  it("links node_modules from the checkout when the lockfile matches", async () => {
    const { source, target } = await makeRoot();
    await writeFile(join(source, "package.json"), "{}");
    await writeFile(join(source, "pnpm-lock.yaml"), "lockfileVersion: 9\n");
    await mkdir(join(source, "node_modules", "left-pad"), { recursive: true });
    await writeFile(join(target, "package.json"), "{}");
    await writeFile(join(target, "pnpm-lock.yaml"), "lockfileVersion: 9\n");

    const action = await prepareWorktreeDependencies({
      sourcePath: source,
      targetPath: target,
      mode: "link",
    });

    expect(action).toEqual({ kind: "linked", entries: ["node_modules"] });
    expect(
      await isSymlinkTo(
        join(target, "node_modules"),
        join(source, "node_modules"),
      ),
    ).toBe(true);
  });

  it("links a python virtualenv alongside node modules", async () => {
    const { source, target } = await makeRoot();
    await mkdir(join(source, ".venv", "bin"), { recursive: true });

    const action = await prepareWorktreeDependencies({
      sourcePath: source,
      targetPath: target,
      mode: "link",
    });

    expect(action).toEqual({ kind: "linked", entries: [".venv"] });
    expect(
      await isSymlinkTo(join(target, ".venv"), join(source, ".venv")),
    ).toBe(true);
  });

  it("falls back to an install when the branch changed the lockfile", async () => {
    const { source, target } = await makeRoot();
    await writeFile(join(source, "package.json"), "{}");
    await writeFile(join(source, "package-lock.json"), '{"v":1}');
    await mkdir(join(source, "node_modules"), { recursive: true });
    await writeFile(join(target, "package.json"), "{}");
    await writeFile(join(target, "package-lock.json"), '{"v":2}');
    const outputs: string[] = [];

    const promise = prepareWorktreeDependencies({
      sourcePath: source,
      targetPath: target,
      mode: "link",
      timeoutMs: 100,
      shellPath: join(target, "no-binaries-here"),
      onProgress: (entry) => outputs.push(entry.text),
    });

    await expect(promise).rejects.toThrow(/npm ci|spawn|ENOENT|timed out/);
    expect(
      await lstat(join(target, "node_modules")).catch(() => null),
    ).toBeNull();
  });

  it("stays out of the way when the repo has its own setup script or nothing to prepare", async () => {
    const { source, target } = await makeRoot();
    await writeFile(join(source, "package.json"), "{}");
    await mkdir(join(source, "node_modules"), { recursive: true });
    await writeFile(join(target, "package.json"), "{}");
    await writeFile(join(target, REPO_SETUP_SCRIPT_NAME), "#!/bin/sh\n");

    expect(
      await prepareWorktreeDependencies({
        sourcePath: source,
        targetPath: target,
        mode: "link",
      }),
    ).toEqual({
      kind: "skipped",
      reason: `${REPO_SETUP_SCRIPT_NAME} owns setup`,
    });

    const bare = await makeRoot();
    expect(
      await prepareWorktreeDependencies({
        sourcePath: bare.source,
        targetPath: bare.target,
        mode: "link",
      }),
    ).toEqual({ kind: "skipped", reason: "no dependency manifest found" });
    expect(
      await prepareWorktreeDependencies({
        sourcePath: source,
        targetPath: target,
        mode: "off",
      }),
    ).toEqual({ kind: "skipped", reason: "disabled" });
  });
});
