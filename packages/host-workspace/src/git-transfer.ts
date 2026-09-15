import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  stat,
  chmod,
  open,
} from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import {
  getAbsoluteGitDir,
  getGitCommonDir,
  runGit,
  type GitProcessOptions,
} from "./git.js";
import { withCheckoutMutationLock } from "./checkout-mutation-lock.js";
import { withGitRefMutationLock } from "./git-ref-mutation-lock.js";

export interface GitTransferRepository {
  remotes: string[];
  subdirectory: string;
}

export interface GitTransferSnapshot extends GitTransferRepository {
  headSha: string;
  indexSha: string;
  workingSha: string;
  bundleRef: string;
  sha256: string;
  sizeBytes: number;
}

function canonicalRemote(value: string): string | null {
  const scp = /^(?:[^/@:]+@)?([^/:]+):(.+)$/u.exec(value);
  const candidate =
    !value.includes("://") && scp ? `ssh://${scp[1]}/${scp[2]}` : value;
  try {
    const url = new URL(candidate);
    if (!["ssh:", "https:", "http:", "git:"].includes(url.protocol))
      return null;
    const port =
      (url.protocol === "ssh:" && url.port === "22") ||
      (url.protocol === "git:" && url.port === "9418")
        ? ""
        : url.port;
    return `${url.hostname.toLowerCase()}${port ? `:${port}` : ""}/${url.pathname.replace(/^\/+|\/+$/gu, "").replace(/\.git$/u, "")}`;
  } catch {
    return null;
  }
}

async function repositoryAt(workspacePath: string, options: GitProcessOptions) {
  const workspace = await realpath(workspacePath);
  const root = await realpath(
    (
      await runGit(["rev-parse", "--show-toplevel"], {
        cwd: workspace,
        ...options,
      })
    ).stdout.trim(),
  );
  const relative = path.relative(root, workspace);
  if (relative.startsWith("..") || path.isAbsolute(relative))
    throw new Error("The project is outside its Git repository");
  const names = (await runGit(["remote"], { cwd: root, ...options })).stdout
    .trim()
    .split("\n")
    .filter(Boolean);
  const remotes = new Set<string>();
  for (const name of names) {
    const result = await runGit(["remote", "get-url", name], {
      cwd: root,
      ...options,
    });
    const remote = canonicalRemote(result.stdout.trim());
    if (remote) remotes.add(remote);
  }
  if (remotes.size === 0)
    throw new Error(
      "Add a Git remote to this project before handing off its workspace",
    );
  return {
    root,
    remotes: [...remotes].sort(),
    subdirectory: relative.split(path.sep).join("/"),
  };
}

async function assertTransferableWorkspace(
  root: string,
  options: GitProcessOptions,
) {
  const tracked = await runGit(["ls-files", "--stage", "-z"], {
    cwd: root,
    ...options,
  });
  if (tracked.stdout.split("\0").some((entry) => entry.startsWith("160000 ")))
    throw new Error(
      "Task handoff does not yet support Git submodules or nested repositories",
    );
  const files = (
    await runGit(
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      { cwd: root, ...options },
    )
  ).stdout
    .split("\0")
    .filter(Boolean);
  for (let offset = 0; offset < files.length; offset += 100) {
    const attributes = (
      await runGit(
        [
          "check-attr",
          "-z",
          "filter",
          "--",
          ...files.slice(offset, offset + 100),
        ],
        { cwd: root, ...options },
      )
    ).stdout.split("\0");
    for (let index = 2; index < attributes.length; index += 3)
      if (attributes[index] === "lfs")
        throw new Error("Task handoff does not yet support Git LFS files");
  }
}

export async function inspectGitTransferRepository(
  workspacePath: string,
  options: GitProcessOptions = {},
): Promise<GitTransferRepository> {
  const { root, remotes, subdirectory } = await repositoryAt(
    workspacePath,
    options,
  );
  await assertTransferableWorkspace(root, options);
  return { remotes, subdirectory };
}

export async function hashGitTransferBundle(
  bundlePath: string,
): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(bundlePath)) hash.update(chunk);
  return hash.digest("hex");
}

export async function snapshotGitWorkspace(
  args: {
    workspacePath: string;
    bundlePath: string;
    signal?: AbortSignal;
  } & GitProcessOptions,
): Promise<GitTransferSnapshot> {
  const { root, remotes, subdirectory } = await repositoryAt(
    args.workspacePath,
    args,
  );
  const commonDir = await getGitCommonDir(root, args);
  return withCheckoutMutationLock(
    root,
    () =>
      withGitRefMutationLock(
        commonDir,
        async () => {
          await assertTransferableWorkspace(root, args);
          const temporary = await mkdtemp(
            path.join(tmpdir(), "kaioken-git-transfer-"),
          );
          const bundleRef = `refs/kaioken/transfers/${randomUUID()}`;
          const indexPath = path.join(temporary, "index");
          const gitOptions = {
            cwd: root,
            shellPath: args.shellPath,
            signal: args.signal,
          };
          const git = async (command: string[], env?: NodeJS.ProcessEnv) =>
            (await runGit(command, { ...gitOptions, env })).stdout.trim();
          const env = { GIT_INDEX_FILE: indexPath };
          let ownsBundle = false;
          try {
            const headSha = await git([
              "rev-parse",
              "--verify",
              "HEAD^{commit}",
            ]);
            await copyFile(
              path.join(await getAbsoluteGitDir(root, args), "index"),
              indexPath,
            );
            const indexTree = await git(["write-tree"], env);
            await git(["add", "--all", "--", "."], env);
            const workingTree = await git(["write-tree"], env);
            const entries = await git(["ls-tree", "-r", "-z", workingTree]);
            if (
              entries.split("\0").some((entry) => entry.startsWith("160000 "))
            )
              throw new Error(
                "Task handoff does not yet support Git submodules or nested repositories",
              );
            const commit = (tree: string, parent: string) =>
              git(
                [
                  "-c",
                  "user.name=Kaioken",
                  "-c",
                  "user.email=handoff@local.invalid",
                  "-c",
                  "commit.gpgsign=false",
                  "commit-tree",
                  tree,
                  "-p",
                  parent,
                  "-m",
                  "Kaioken workspace transfer",
                ],
                env,
              );
            const indexSha = await commit(indexTree, headSha);
            const workingSha = await commit(workingTree, indexSha);
            await git(["update-ref", bundleRef, workingSha]);
            await mkdir(path.dirname(args.bundlePath), {
              recursive: true,
              mode: 0o700,
            });
            const output = await open(args.bundlePath, "wx", 0o600);
            ownsBundle = true;
            await output.close();
            await git(["bundle", "create", args.bundlePath, bundleRef]);
            await chmod(args.bundlePath, 0o600);
            return {
              remotes,
              subdirectory,
              headSha,
              indexSha,
              workingSha,
              bundleRef,
              sha256: await hashGitTransferBundle(args.bundlePath),
              sizeBytes: (await stat(args.bundlePath)).size,
            };
          } catch (error) {
            if (ownsBundle) await rm(args.bundlePath, { force: true });
            throw error;
          } finally {
            await runGit(["update-ref", "-d", bundleRef], {
              ...gitOptions,
              signal: undefined,
            });
            await rm(temporary, { recursive: true, force: true });
          }
        },
        { signal: args.signal },
      ),
    args.signal,
    args,
  );
}

export async function restoreGitWorkspace(
  args: {
    projectPath: string;
    worktreePath: string;
    bundlePath: string;
    snapshot: GitTransferSnapshot;
    branchName: string;
    signal?: AbortSignal;
  } & GitProcessOptions,
): Promise<{ path: string; branchName: string }> {
  const repository = await repositoryAt(args.projectPath, args);
  if (
    repository.subdirectory !== args.snapshot.subdirectory ||
    !repository.remotes.some((remote) => args.snapshot.remotes.includes(remote))
  )
    throw new Error(
      "Choose the same repository and project subdirectory on the destination computer",
    );
  if (
    await lstat(args.worktreePath).catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT")
        return null;
      throw error;
    })
  )
    throw new Error(
      "The destination worktree already exists; it was left unchanged",
    );
  if (
    (await stat(args.bundlePath)).size !== args.snapshot.sizeBytes ||
    (await hashGitTransferBundle(args.bundlePath)) !== args.snapshot.sha256
  )
    throw new Error("The workspace transfer is incomplete or damaged");
  const commonDir = await getGitCommonDir(repository.root, args);
  return withGitRefMutationLock(
    commonDir,
    async () => {
      const gitOptions = {
        cwd: repository.root,
        shellPath: args.shellPath,
        signal: args.signal,
      };
      const git = async (command: string[]) =>
        (await runGit(command, gitOptions)).stdout.trim();
      await git(["bundle", "verify", args.bundlePath]);
      const heads = await git(["bundle", "list-heads", args.bundlePath]);
      if (heads !== `${args.snapshot.workingSha} ${args.snapshot.bundleRef}`)
        throw new Error(
          "The workspace bundle does not match the selected transfer",
        );
      await git([
        "-c",
        "fetch.fsckObjects=true",
        "fetch",
        "--no-tags",
        "--no-write-fetch-head",
        args.bundlePath,
        args.snapshot.bundleRef,
      ]);
      const parent = await git(["rev-parse", `${args.snapshot.workingSha}^`]);
      const head = await git(["rev-parse", `${args.snapshot.indexSha}^`]);
      if (parent !== args.snapshot.indexSha || head !== args.snapshot.headSha)
        throw new Error("The workspace bundle has an invalid snapshot history");
      await mkdir(path.dirname(args.worktreePath), { recursive: true });
      await git(["check-ref-format", "--branch", args.branchName]);
      const existingBranch = await runGit(
        ["show-ref", "--verify", `refs/heads/${args.branchName}`],
        { ...gitOptions, allowFailure: true },
      );
      if (existingBranch.exitCode === 0)
        throw new Error(
          "The handoff branch already exists; it was left unchanged",
        );
      try {
        await git([
          "worktree",
          "add",
          "-b",
          args.branchName,
          "--",
          args.worktreePath,
          args.snapshot.workingSha,
        ]);
        await runGit(["reset", "--soft", args.snapshot.headSha], {
          ...gitOptions,
          cwd: args.worktreePath,
        });
        await runGit(["read-tree", args.snapshot.indexSha], {
          ...gitOptions,
          cwd: args.worktreePath,
        });
        const workspacePath = path.join(
          args.worktreePath,
          ...args.snapshot.subdirectory.split("/").filter(Boolean),
        );
        await stat(workspacePath);
        return { path: workspacePath, branchName: args.branchName };
      } catch (error) {
        const rollback = {
          ...gitOptions,
          signal: undefined,
          allowFailure: true,
        };
        const removed = await runGit(
          ["worktree", "remove", "--force", args.worktreePath],
          rollback,
        );
        const branch = await runGit(
          ["rev-parse", "--verify", `refs/heads/${args.branchName}`],
          rollback,
        );
        if (
          removed.exitCode === 0 &&
          [args.snapshot.headSha, args.snapshot.workingSha].includes(
            branch.stdout.trim(),
          )
        )
          await runGit(["branch", "-D", args.branchName], rollback);
        throw error;
      }
    },
    { signal: args.signal },
  );
}
