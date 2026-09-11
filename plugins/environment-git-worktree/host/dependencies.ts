import {
  experimental_sanitizeInheritedChildProcessEnv as sanitizeInheritedChildProcessEnv,
  experimental_spawnPortableOutputProcess as spawnPortableOutputProcess,
} from "@get-kaioken/plugin-sdk/host";
import fs from "node:fs/promises";
import path from "node:path";
import {
  emitOutput,
  emitStep,
  isProvisionAbortError,
  throwIfProvisionAborted,
  type ProgressCallback,
} from "kaioken-environment-provider-host/transcript";

export const DEPENDENCY_PREPARATION_MODES = ["link", "install", "off"] as const;
export type DependencyPreparationMode =
  (typeof DEPENDENCY_PREPARATION_MODES)[number];

export const REPO_SETUP_SCRIPT_NAME = ".kaioken-env-setup.sh";
const TRANSCRIPT_KEY = "worktree-dependencies";
const INSTALL_TIMEOUT_MS = 10 * 60 * 1000;

interface NodePackageManager {
  name: "pnpm" | "yarn" | "bun" | "npm";
  lockfile: string | null;
  installArgs: string[];
}

const NODE_LOCKFILES: ReadonlyArray<
  [lockfile: string, manager: NodePackageManager["name"]]
> = [
  ["pnpm-lock.yaml", "pnpm"],
  ["bun.lock", "bun"],
  ["bun.lockb", "bun"],
  ["yarn.lock", "yarn"],
  ["package-lock.json", "npm"],
];

export interface PrepareWorktreeDependenciesArgs {
  sourcePath: string;
  targetPath: string;
  mode: DependencyPreparationMode;
  onProgress?: ProgressCallback | undefined;
  shellPath?: string | undefined;
  signal?: AbortSignal | undefined;
  timeoutMs?: number;
}

export type PrepareWorktreeDependenciesAction =
  | { kind: "skipped"; reason: string }
  | { kind: "linked"; entries: string[] }
  | { kind: "installed"; command: string };

async function pathExists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch {
    return false;
  }
}

async function readFileOrNull(target: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(target);
  } catch {
    return null;
  }
}

async function detectNodePackageManager(
  targetPath: string,
): Promise<NodePackageManager | null> {
  if (!(await pathExists(path.join(targetPath, "package.json")))) {
    return null;
  }
  for (const [lockfile, name] of NODE_LOCKFILES) {
    if (await pathExists(path.join(targetPath, lockfile))) {
      return {
        name,
        lockfile,
        installArgs:
          name === "npm"
            ? ["ci"]
            : name === "pnpm"
              ? ["install", "--frozen-lockfile", "--prefer-offline"]
              : ["install"],
      };
    }
  }
  return { name: "npm", lockfile: null, installArgs: ["install"] };
}

async function lockfilesMatch(
  sourcePath: string,
  targetPath: string,
  lockfile: string | null,
): Promise<boolean> {
  if (lockfile === null) return true;
  const [source, target] = await Promise.all([
    readFileOrNull(path.join(sourcePath, lockfile)),
    readFileOrNull(path.join(targetPath, lockfile)),
  ]);
  return source !== null && target !== null && source.equals(target);
}

async function linkEntry(
  sourcePath: string,
  targetPath: string,
  entry: string,
): Promise<boolean> {
  const source = path.join(sourcePath, entry);
  const target = path.join(targetPath, entry);
  if (!(await pathExists(source)) || (await pathExists(target))) {
    return false;
  }
  await fs.symlink(source, target, "dir");
  return true;
}

function runInstall(args: {
  cwd: string;
  manager: NodePackageManager;
  shellPath: string | undefined;
  signal: AbortSignal | undefined;
  timeoutMs: number;
  onProgress: ProgressCallback | undefined;
}): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawnPortableOutputProcess({
      command: args.manager.name,
      args: args.manager.installArgs,
      cwd: args.cwd,
      env: {
        ...sanitizeInheritedChildProcessEnv({
          env: process.env,
          ...(args.shellPath === undefined
            ? {}
            : { shellPath: args.shellPath }),
        }),
        CI: "1",
      },
    });
    let settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      args.signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    const onAbort = () => {
      child.kill("SIGTERM");
      finish(new Error("Dependency install cancelled"));
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(
        new Error(
          `Dependency install timed out after ${Math.round(args.timeoutMs / 1000)}s`,
        ),
      );
    }, args.timeoutMs);
    args.signal?.addEventListener("abort", onAbort, { once: true });
    const forward = (chunk: Buffer) => {
      const text = chunk.toString("utf8").trimEnd();
      if (text.length > 0) emitOutput(args.onProgress, TRANSCRIPT_KEY, text);
    };
    child.stdout.on("data", forward);
    child.stderr.on("data", forward);
    child.on("error", (error) => finish(error));
    child.on("exit", (code, signal) => {
      if (code === 0) {
        finish(null);
        return;
      }
      finish(
        new Error(
          `${args.manager.name} ${args.manager.installArgs.join(" ")} exited with ${
            code === null ? `signal ${signal ?? "unknown"}` : `code ${code}`
          }`,
        ),
      );
    });
  });
}

export async function prepareWorktreeDependencies(
  args: PrepareWorktreeDependenciesArgs,
): Promise<PrepareWorktreeDependenciesAction> {
  if (args.mode === "off") {
    return { kind: "skipped", reason: "disabled" };
  }
  throwIfProvisionAborted(args.signal);
  if (await pathExists(path.join(args.targetPath, REPO_SETUP_SCRIPT_NAME))) {
    return {
      kind: "skipped",
      reason: `${REPO_SETUP_SCRIPT_NAME} owns setup`,
    };
  }
  const manager = await detectNodePackageManager(args.targetPath);
  const pythonVenv = await pathExists(path.join(args.sourcePath, ".venv"));
  if (manager === null && !pythonVenv) {
    return { kind: "skipped", reason: "no dependency manifest found" };
  }

  const linked: string[] = [];
  if (
    pythonVenv &&
    (await linkEntry(args.sourcePath, args.targetPath, ".venv"))
  ) {
    linked.push(".venv");
  }
  if (manager === null) {
    return { kind: "linked", entries: linked };
  }

  const canLink =
    args.mode === "link" &&
    (await pathExists(path.join(args.sourcePath, "node_modules"))) &&
    (await lockfilesMatch(args.sourcePath, args.targetPath, manager.lockfile));
  if (canLink) {
    if (await linkEntry(args.sourcePath, args.targetPath, "node_modules")) {
      linked.push("node_modules");
    }
    return { kind: "linked", entries: linked };
  }

  const command = `${manager.name} ${manager.installArgs.join(" ")}`;
  await runInstall({
    cwd: args.targetPath,
    manager,
    shellPath: args.shellPath,
    signal: args.signal,
    timeoutMs: args.timeoutMs ?? INSTALL_TIMEOUT_MS,
    onProgress: args.onProgress,
  });
  return { kind: "installed", command };
}

export async function prepareWorktreeDependenciesStep(
  args: PrepareWorktreeDependenciesArgs,
): Promise<void> {
  if (args.mode === "off") return;
  const startedAt = Date.now();
  emitStep({
    onProgress: args.onProgress,
    key: TRANSCRIPT_KEY,
    text: "Preparing dependencies",
    status: "started",
    startedAt,
  });
  try {
    const action = await prepareWorktreeDependencies(args);
    const summary =
      action.kind === "skipped"
        ? `Dependencies: skipped (${action.reason})`
        : action.kind === "linked"
          ? action.entries.length === 0
            ? "Dependencies: nothing to link"
            : `Dependencies: linked ${action.entries.join(", ")} from the project checkout`
          : `Dependencies: ran ${action.command}`;
    emitStep({
      onProgress: args.onProgress,
      key: TRANSCRIPT_KEY,
      text: summary,
      status: "completed",
      startedAt,
    });
  } catch (error) {
    if (isProvisionAbortError(error)) throw error;
    emitStep({
      onProgress: args.onProgress,
      key: TRANSCRIPT_KEY,
      text: `Dependencies: ${error instanceof Error ? error.message : String(error)}. Continuing without them.`,
      status: "failed",
      startedAt,
    });
  }
}
