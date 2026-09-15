import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  symlink,
  readlink,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runGit } from "../src/git.js";
import {
  inspectGitTransferRepository,
  restoreGitWorkspace,
  snapshotGitWorkspace,
} from "../src/git-transfer.js";

const directories: string[] = [];
afterEach(async () => {
  for (const directory of directories.splice(0))
    await rm(directory, { recursive: true, force: true });
});

async function fixture() {
  const directory = await mkdtemp(
    path.join(tmpdir(), "kaioken-transfer-test-"),
  );
  directories.push(directory);
  const source = path.join(directory, "source");
  const destination = path.join(directory, "destination");
  const bundlePath = path.join(directory, "transfer.bundle");
  const worktreePath = path.join(directory, "worktree");
  await mkdir(path.join(source, "app"), { recursive: true });
  await runGit(["init", "-b", "main"], { cwd: source });
  await runGit(["config", "user.name", "Fixture"], { cwd: source });
  await runGit(["config", "user.email", "fixture@example.test"], {
    cwd: source,
  });
  await writeFile(path.join(source, "app/file.txt"), "original\n");
  await writeFile(path.join(source, "app/remove.txt"), "remove later\n");
  await writeFile(path.join(source, ".gitignore"), "private.txt\n");
  await runGit(["add", "."], { cwd: source });
  await runGit(["commit", "-m", "Initial"], { cwd: source });
  await runGit(["clone", "--local", source, destination], { cwd: directory });
  await runGit(
    ["remote", "add", "origin", "git@example.test:org/project.git"],
    { cwd: source },
  );
  await runGit(
    ["remote", "set-url", "origin", "https://example.test/org/project"],
    { cwd: destination },
  );
  return { directory, source, destination, bundlePath, worktreePath };
}

it("restores staged and working changes separately in a matching project without altering either checkout", async () => {
  const { source, destination, bundlePath, worktreePath } = await fixture();
  await writeFile(path.join(source, "app/file.txt"), "staged\n");
  await runGit(["add", "app/file.txt"], { cwd: source });
  await writeFile(path.join(source, "app/file.txt"), "unstaged\n");
  await writeFile(path.join(source, "app/new.bin"), Buffer.from([0, 255, 128]));
  await writeFile(
    path.join(source, "private.txt"),
    "Do not transfer ignored data",
  );
  await rm(path.join(source, "app/remove.txt"));
  await symlink("file.txt", path.join(source, "app/link"));
  const sourceIndex = await readFile(path.join(source, ".git/index"));
  const snapshot = await snapshotGitWorkspace({
    workspacePath: path.join(source, "app"),
    bundlePath,
  });
  expect(await readFile(path.join(source, ".git/index"))).toEqual(sourceIndex);
  expect(
    (await runGit(["rev-parse", "HEAD"], { cwd: source })).stdout.trim(),
  ).toBe(snapshot.headSha);
  expect(
    (await runGit(["for-each-ref", "refs/kaioken/transfers"], { cwd: source }))
      .stdout,
  ).toBe("");
  expect(snapshot.subdirectory).toBe("app");
  expect((await stat(bundlePath)).mode & 0o777).toBe(0o600);
  const result = await restoreGitWorkspace({
    projectPath: path.join(destination, "app"),
    worktreePath,
    bundlePath,
    snapshot,
    branchName: "codex/handoff-test",
  });
  expect(result.path).toBe(path.join(worktreePath, "app"));
  expect(await readFile(path.join(destination, "app/file.txt"), "utf8")).toBe(
    "original\n",
  );
  expect(await readFile(path.join(worktreePath, "app/file.txt"), "utf8")).toBe(
    "unstaged\n",
  );
  expect(
    (await runGit(["show", ":app/file.txt"], { cwd: worktreePath })).stdout,
  ).toBe("staged\n");
  expect(
    (await runGit(["rev-parse", "HEAD"], { cwd: worktreePath })).stdout.trim(),
  ).toBe(snapshot.headSha);
  expect(await readFile(path.join(worktreePath, "app/new.bin"))).toEqual(
    Buffer.from([0, 255, 128]),
  );
  expect(await readlink(path.join(worktreePath, "app/link"))).toBe("file.txt");
  await expect(
    stat(path.join(worktreePath, "app/remove.txt")),
  ).rejects.toThrow();
  await expect(stat(path.join(worktreePath, "private.txt"))).rejects.toThrow();
  expect(
    (await runGit(["diff", "--cached"], { cwd: worktreePath })).stdout,
  ).toBe((await runGit(["diff", "--cached"], { cwd: source })).stdout);
  expect((await runGit(["diff"], { cwd: worktreePath })).stdout).toBe(
    (await runGit(["diff"], { cwd: source })).stdout,
  );
});

it("refuses the wrong repository, wrong subdirectory, corrupt data and existing destination paths", async () => {
  const { source, destination, bundlePath, worktreePath } = await fixture();
  const snapshot = await snapshotGitWorkspace({
    workspacePath: path.join(source, "app"),
    bundlePath,
  });
  const args = {
    projectPath: path.join(destination, "app"),
    worktreePath,
    bundlePath,
    snapshot,
    branchName: "codex/handoff-test",
  };
  await expect(
    restoreGitWorkspace({ ...args, projectPath: destination }),
  ).rejects.toThrow("same repository and project subdirectory");
  await runGit(
    ["remote", "set-url", "origin", "https://example.test/org/unrelated"],
    { cwd: destination },
  );
  await expect(restoreGitWorkspace(args)).rejects.toThrow(
    "same repository and project subdirectory",
  );
  await runGit(
    [
      "remote",
      "set-url",
      "origin",
      "ssh://git@example.test:22/org/project.git",
    ],
    { cwd: destination },
  );
  expect((await inspectGitTransferRepository(destination)).remotes).toEqual(
    snapshot.remotes,
  );
  await expect(
    restoreGitWorkspace({
      ...args,
      snapshot: { ...snapshot, sha256: "0".repeat(64) },
    }),
  ).rejects.toThrow("incomplete or damaged");
  await mkdir(worktreePath);
  await writeFile(path.join(worktreePath, "keep.txt"), "existing work");
  await expect(restoreGitWorkspace(args)).rejects.toThrow("already exists");
  expect(await readFile(path.join(worktreePath, "keep.txt"), "utf8")).toBe(
    "existing work",
  );
  await expect(
    snapshotGitWorkspace({ workspacePath: source, bundlePath }),
  ).rejects.toThrow();
  expect((await stat(bundlePath)).size).toBe(snapshot.sizeBytes);
});

it("rejects an unmerged index without changing the source or leaving transfer references", async () => {
  const { source, bundlePath } = await fixture();
  await runGit(["switch", "-c", "feature"], { cwd: source });
  await writeFile(path.join(source, "app/file.txt"), "feature\n");
  await runGit(["commit", "-am", "Feature"], { cwd: source });
  await runGit(["switch", "main"], { cwd: source });
  await writeFile(path.join(source, "app/file.txt"), "main\n");
  await runGit(["commit", "-am", "Main"], { cwd: source });
  await runGit(["merge", "feature"], { cwd: source, allowFailure: true });
  const before = await readFile(path.join(source, ".git/index"));
  await expect(
    snapshotGitWorkspace({ workspacePath: source, bundlePath }),
  ).rejects.toThrow();
  expect(await readFile(path.join(source, ".git/index"))).toEqual(before);
  expect(
    (await runGit(["for-each-ref", "refs/kaioken/transfers"], { cwd: source }))
      .stdout,
  ).toBe("");
  await expect(stat(bundlePath)).rejects.toThrow();
});

it("cleans up a new worktree after a checkout hook fails while leaving existing branches alone", async () => {
  const { source, destination, bundlePath, worktreePath } = await fixture();
  const snapshot = await snapshotGitWorkspace({
    workspacePath: source,
    bundlePath,
  });
  const args = {
    projectPath: destination,
    bundlePath,
    worktreePath,
    snapshot,
    branchName: "codex/handoff-test",
  };
  await runGit(["branch", args.branchName], { cwd: destination });
  await expect(restoreGitWorkspace(args)).rejects.toThrow(
    "branch already exists",
  );
  expect(
    (
      await runGit(["rev-parse", args.branchName], { cwd: destination })
    ).stdout.trim(),
  ).toBe(snapshot.headSha);
  await runGit(["branch", "-D", args.branchName], { cwd: destination });
  await writeFile(
    path.join(destination, ".git/hooks/post-checkout"),
    "#!/bin/sh\nexit 1\n",
    { mode: 0o755 },
  );
  await expect(restoreGitWorkspace(args)).rejects.toThrow();
  await expect(stat(worktreePath)).rejects.toThrow();
  expect(
    (
      await runGit(["show-ref", "--verify", `refs/heads/${args.branchName}`], {
        cwd: destination,
        allowFailure: true,
      })
    ).exitCode,
  ).not.toBe(0);
  expect(await readFile(path.join(destination, "app/file.txt"), "utf8")).toBe(
    "original\n",
  );
});

it("refuses submodules and LFS files before producing an incomplete workspace transfer", async () => {
  const { source, bundlePath } = await fixture();
  const head = (
    await runGit(["rev-parse", "HEAD"], { cwd: source })
  ).stdout.trim();
  await runGit(
    ["update-index", "--add", "--cacheinfo", `160000,${head},dependency`],
    { cwd: source },
  );
  await expect(inspectGitTransferRepository(source)).rejects.toThrow(
    /submodules/,
  );
  await expect(
    snapshotGitWorkspace({ workspacePath: source, bundlePath }),
  ).rejects.toThrow(/submodules/);
  await runGit(["update-index", "--force-remove", "dependency"], {
    cwd: source,
  });
  await writeFile(
    path.join(source, ".gitattributes"),
    "app/*.txt filter=lfs diff=lfs merge=lfs -text\n",
  );
  await expect(inspectGitTransferRepository(source)).rejects.toThrow(/Git LFS/);
  await expect(
    snapshotGitWorkspace({ workspacePath: source, bundlePath }),
  ).rejects.toThrow(/Git LFS/);
  await expect(stat(bundlePath)).rejects.toThrow();
});
