import { isDeepStrictEqual } from "node:util";
import { createHash } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import {
  findRolloutsInHomes,
  installTransferredCodexSession,
  prepareCodexSessionTransfer,
  PRIVATE_CODEX_HOME_RELATIVE_PATH,
  resolveCodexHomes,
  type CodexHomes,
} from "@kaioken/codex-rollout/files";
import {
  WORKSPACE_TRANSFER_CHUNK_BYTES,
  workspaceTransferManifestSchema,
  workspaceTransferRestoredSchema,
} from "@kaioken/host-daemon-contract";
import {
  hashGitTransferBundle,
  inspectGitTransferRepository,
  restoreGitWorkspace,
  runGit,
  snapshotGitWorkspace,
} from "@kaioken/host-workspace";
import type {
  CommandDispatchOptions,
  CommandOf,
} from "../command-dispatch-support.js";
import { userExecutableProcessOptions } from "../user-executable-env.js";

type Options = Pick<CommandDispatchOptions, "dataDir"> & {
  runtimeManager: Pick<CommandDispatchOptions["runtimeManager"], "getShellEnv">;
  codexHomes?: CodexHomes;
};
const queues = new Map<string, Promise<void>>();
async function exclusively<T>(
  key: string,
  action: () => Promise<T>,
): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const result = previous.then(action);
  const settled = result.then(
    () => undefined,
    () => undefined,
  );
  queues.set(key, settled);
  try {
    return await result;
  } finally {
    if (queues.get(key) === settled) queues.delete(key);
  }
}
const directoryFor = (
  options: Options,
  id: string,
  direction: "incoming" | "outgoing",
) => path.join(options.dataDir, "workspace-transfers", direction, id);
const fileName = (file: "git" | "session") =>
  file === "git" ? "workspace.bundle" : "session.jsonl";
const exportReceiptSchema = z.object({
  path: z.string(),
  manifest: workspaceTransferManifestSchema,
});
const restoreReceiptSchema = z.object({
  sessionHome: z.enum(["private", "shared"]),
  projectPath: z.string(),
  manifest: workspaceTransferManifestSchema,
  result: workspaceTransferRestoredSchema,
});
const restoreIntentSchema = z.object({
  sessionHome: z.enum(["private", "shared"]),
  projectPath: z.string(),
  manifest: workspaceTransferManifestSchema,
  targetProviderThreadId: z.string().uuid(),
});
async function readOptionalJson(file: string): Promise<unknown | null> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return null;
    throw error;
  }
}
async function writeReceipt(file: string, value: object): Promise<void> {
  await writeFile(`${file}.tmp`, JSON.stringify(value), { mode: 0o600 });
  await rename(`${file}.tmp`, file);
}
export async function inspectTransferWorkspace(
  command: CommandOf<"workspace.transfer.inspect">,
  options: Options,
) {
  return inspectGitTransferRepository(
    command.path,
    userExecutableProcessOptions(options.runtimeManager.getShellEnv()),
  );
}
export async function exportTransferWorkspace(
  command: CommandOf<"workspace.transfer.export">,
  options: Options,
) {
  const directory = directoryFor(options, command.operationId, "outgoing");
  return exclusively(directory, async () => {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const raw = await readOptionalJson(path.join(directory, "receipt.json"));
    if (raw !== null) {
      const receipt = exportReceiptSchema.parse(raw);
      if (
        receipt.path !== command.path ||
        receipt.manifest.providerThreadId !== command.providerThreadId
      )
        throw new Error(
          "This transfer identity already belongs to another workspace or session",
        );
      return receipt.manifest;
    }
    const homes =
      options.codexHomes ??
      resolveCodexHomes({ env: process.env, homeDir: homedir() });
    const files = findRolloutsInHomes(homes, command.providerThreadId, [
      "private",
      "shared",
    ]);
    if (!files)
      throw new Error(
        "The native Codex session could not be found on this computer",
      );
    const contents = prepareCodexSessionTransfer({
      contents: await Promise.all(
        files.paths.map((file) => readFile(file, "utf8")),
      ),
      sourceProviderThreadId: command.providerThreadId,
      targetProviderThreadId: command.providerThreadId,
      workspacePath: command.path,
    });
    const bundlePath = path.join(directory, fileName("git"));
    await rm(bundlePath, { force: true });
    const git = await snapshotGitWorkspace({
      workspacePath: command.path,
      bundlePath,
      ...userExecutableProcessOptions(options.runtimeManager.getShellEnv()),
    });
    await writeFile(path.join(directory, fileName("session")), contents, {
      mode: 0o600,
    });
    const manifest = workspaceTransferManifestSchema.parse({
      git,
      providerThreadId: command.providerThreadId,
      session: {
        sha256: createHash("sha256").update(contents).digest("hex"),
        sizeBytes: Buffer.byteLength(contents),
      },
    });
    await writeReceipt(path.join(directory, "receipt.json"), {
      path: command.path,
      manifest,
    });
    return manifest;
  });
}
export async function readTransferChunk(
  command: CommandOf<"workspace.transfer.read">,
  options: Options,
) {
  const directory = directoryFor(options, command.operationId, "outgoing");
  exportReceiptSchema.parse(
    await readOptionalJson(path.join(directory, "receipt.json")),
  );
  const file = await open(path.join(directory, fileName(command.file)), "r");
  try {
    const size = (await file.stat()).size;
    if (command.offset > size)
      throw new Error("The requested transfer offset is outside the file");
    const buffer = Buffer.alloc(
      Math.min(WORKSPACE_TRANSFER_CHUNK_BYTES, size - command.offset),
    );
    const { bytesRead } = await file.read(
      buffer,
      0,
      buffer.length,
      command.offset,
    );
    return {
      data: buffer.subarray(0, bytesRead).toString("base64"),
      nextOffset: command.offset + bytesRead,
      done: command.offset + bytesRead === size,
    };
  } finally {
    await file.close();
  }
}
export async function writeTransferChunk(
  command: CommandOf<"workspace.transfer.write">,
  options: Options,
) {
  const directory = directoryFor(options, command.operationId, "incoming");
  return exclusively(directory, async () => {
    const data = Buffer.from(command.data, "base64");
    if (
      data.toString("base64") !== command.data ||
      data.length === 0 ||
      data.length > WORKSPACE_TRANSFER_CHUNK_BYTES
    )
      throw new Error("The transfer chunk is not valid base64 data");
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const filePath = path.join(directory, fileName(command.file));
    const file = await open(filePath, "a+", 0o600);
    try {
      const size = (await file.stat()).size;
      if (command.offset < size) {
        const existing = Buffer.alloc(data.length);
        const { bytesRead } = await file.read(
          existing,
          0,
          existing.length,
          command.offset,
        );
        if (
          !existing.subarray(0, bytesRead).equals(data.subarray(0, bytesRead))
        )
          throw new Error(
            "A different transfer chunk already occupies this offset",
          );
        if (bytesRead < data.length) {
          await file.writeFile(data.subarray(bytesRead));
          await file.sync();
        }
      } else {
        if (command.offset !== size)
          throw new Error("Transfer chunks must arrive in order");
        await file.writeFile(data);
        await file.sync();
      }
      return { nextOffset: command.offset + data.length };
    } finally {
      await file.close();
    }
  });
}
export async function restoreTransferWorkspace(
  command: CommandOf<"workspace.transfer.restore">,
  options: Options,
) {
  const directory = directoryFor(options, command.operationId, "incoming");
  return exclusively(directory, async () => {
    const receiptPath = path.join(directory, "receipt.json");
    const raw = await readOptionalJson(receiptPath);
    if (raw !== null) {
      const receipt = restoreReceiptSchema.parse(raw);
      if (
        receipt.projectPath !== command.projectPath ||
        receipt.sessionHome !== command.sessionHome ||
        receipt.result.providerThreadId !== command.targetProviderThreadId ||
        !isDeepStrictEqual(receipt.manifest, command.manifest)
      )
        throw new Error(
          "This transfer identity already belongs to a different handoff",
        );
      return receipt.result;
    }
    const sessionPath = path.join(directory, fileName("session"));
    if (
      (await stat(sessionPath)).size !== command.manifest.session.sizeBytes ||
      (await hashGitTransferBundle(sessionPath)) !==
        command.manifest.session.sha256
    )
      throw new Error("The transferred Codex session is incomplete or damaged");
    const worktreePath = path.join(
      options.dataDir,
      "worktrees",
      `handoff-${command.operationId}`,
    );
    const workspacePath = path.join(
      worktreePath,
      command.manifest.git.subdirectory,
    );
    const intent = {
      sessionHome: command.sessionHome,
      projectPath: command.projectPath,
      manifest: command.manifest,
      targetProviderThreadId: command.targetProviderThreadId,
    };
    const savedIntent = await readOptionalJson(
      path.join(directory, "intent.json"),
    );
    const existingWorktree = await stat(worktreePath).catch(
      (error: unknown) => {
        if (
          error instanceof Error &&
          "code" in error &&
          error.code === "ENOENT"
        )
          return null;
        throw error;
      },
    );
    if (savedIntent === null && existingWorktree)
      throw new Error(
        "The destination worktree already exists; it was left unchanged",
      );
    if (
      savedIntent !== null &&
      !isDeepStrictEqual(restoreIntentSchema.parse(savedIntent), intent)
    )
      throw new Error(
        "The saved worktree transfer belongs to a different handoff",
      );
    await writeReceipt(path.join(directory, "intent.json"), intent);
    const contents = prepareCodexSessionTransfer({
      contents: [await readFile(sessionPath, "utf8")],
      sourceProviderThreadId: command.manifest.providerThreadId,
      targetProviderThreadId: command.targetProviderThreadId,
      workspacePath,
    });
    await installTransferredCodexSession({
      codexHome:
        options.codexHomes?.[command.sessionHome] ??
        (command.sessionHome === "private"
          ? path.join(homedir(), PRIVATE_CODEX_HOME_RELATIVE_PATH)
          : resolveCodexHomes({ env: process.env, homeDir: homedir() }).shared),
      providerThreadId: command.targetProviderThreadId,
      contents,
    });
    if (existingWorktree) {
      const gitOptions = {
        cwd: workspacePath,
        ...userExecutableProcessOptions(options.runtimeManager.getShellEnv()),
      };
      const git = async (args: string[]) =>
        (await runGit(args, gitOptions)).stdout.trim();
      const verificationBundle = path.join(directory, "recovery.bundle");
      await rm(verificationBundle, { force: true });
      const current = await snapshotGitWorkspace({
        workspacePath,
        bundlePath: verificationBundle,
        ...gitOptions,
      });
      try {
        const snapshot = command.manifest.git;
        const expectedWorkingTree = await git([
          "rev-parse",
          `${snapshot.workingSha}^{tree}`,
        ]);
        const expectedIndexTree = await git([
          "rev-parse",
          `${snapshot.indexSha}^{tree}`,
        ]);
        const actualIndexTree = await git([
          "rev-parse",
          `${current.indexSha}^{tree}`,
        ]);
        if (
          (await git(["branch", "--show-current"])) !==
            `codex/handoff-${command.operationId}` ||
          ![snapshot.headSha, snapshot.workingSha].includes(current.headSha) ||
          ![expectedIndexTree, expectedWorkingTree].includes(actualIndexTree) ||
          (await git(["rev-parse", `${current.workingSha}^{tree}`])) !==
            expectedWorkingTree
        )
          throw new Error(
            "The interrupted destination worktree has changed. Its files were preserved; cancel this move and start a new handoff.",
          );
        await git(["reset", "--soft", snapshot.headSha]);
        await git(["read-tree", snapshot.indexSha]);
      } finally {
        await rm(verificationBundle, { force: true });
      }
    } else {
      await restoreGitWorkspace({
        projectPath: command.projectPath,
        worktreePath,
        bundlePath: path.join(directory, fileName("git")),
        snapshot: command.manifest.git,
        branchName: `codex/handoff-${command.operationId}`,
        ...userExecutableProcessOptions(options.runtimeManager.getShellEnv()),
      });
    }
    const result = {
      workspacePath,
      providerThreadId: command.targetProviderThreadId,
    };
    await writeReceipt(receiptPath, {
      sessionHome: command.sessionHome,
      projectPath: command.projectPath,
      manifest: command.manifest,
      result,
    });
    return result;
  });
}
