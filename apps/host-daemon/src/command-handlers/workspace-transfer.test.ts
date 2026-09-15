import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import { runGit } from "@kaioken/host-workspace";
import {
  exportTransferWorkspace,
  readTransferChunk,
  writeTransferChunk,
  restoreTransferWorkspace,
} from "./workspace-transfer.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
it.each(["private", "shared"] as const)(
  "transfers real Git and native Codex files between isolated daemon homes with safe retries into %s",
  async (sessionHome) => {
    const directory = await mkdtemp(
      path.join(tmpdir(), "kaioken-handoff-daemon-"),
    );
    directories.push(directory);
    const sourcePath = path.join(directory, "source-repo");
    const projectPath = path.join(directory, "destination-repo");
    await mkdir(sourcePath);
    await runGit(["init", "-b", "main"], { cwd: sourcePath });
    await runGit(["config", "user.name", "Transfer fixture"], {
      cwd: sourcePath,
    });
    await runGit(["config", "user.email", "fixture@example.test"], {
      cwd: sourcePath,
    });
    await writeFile(path.join(sourcePath, "file.txt"), "original");
    await runGit(["add", "."], { cwd: sourcePath });
    await runGit(["commit", "-m", "Initial"], { cwd: sourcePath });
    await runGit(["clone", "--local", sourcePath, projectPath], {
      cwd: directory,
    });
    await runGit(["remote", "add", "origin", "git@example.test:org/repo.git"], {
      cwd: sourcePath,
    });
    await runGit(
      ["remote", "set-url", "origin", "https://example.test/org/repo"],
      { cwd: projectPath },
    );
    await writeFile(path.join(sourcePath, "file.txt"), "staged");
    await runGit(["add", "."], { cwd: sourcePath });
    await writeFile(path.join(sourcePath, "file.txt"), "working");
    const providerThreadId = randomUUID();
    const sessionDirectory = path.join(
      directory,
      "source-codex",
      "sessions",
      "2026",
      "09",
      "15",
    );
    await mkdir(sessionDirectory, { recursive: true });
    const contents = [
      {
        type: "session_meta",
        payload: {
          id: providerThreadId,
          cwd: sourcePath,
          timestamp: "2026-09-15T00:00:00Z",
        },
      },
      {
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Keep native context" }],
        },
      },
    ]
      .map((value) => JSON.stringify(value))
      .join("\n");
    await writeFile(
      path.join(sessionDirectory, `rollout-${providerThreadId}.jsonl`),
      contents,
    );
    const options = (kind: string) => ({
      dataDir: path.join(directory, `${kind}-daemon`),
      runtimeManager: { getShellEnv: () => ({ PATH: process.env.PATH ?? "" }) },
      codexHomes: {
        shared: path.join(directory, `${kind}-codex`),
        private: path.join(directory, `${kind}-codex`),
      },
    });
    const source = options("source"),
      destination = options("destination");
    const operationId = randomUUID();
    const exported = {
      type: "workspace.transfer.export" as const,
      operationId,
      path: sourcePath,
      providerThreadId,
    };
    const manifest = await exportTransferWorkspace(exported, source);
    expect(await exportTransferWorkspace(exported, source)).toEqual(manifest);
    await expect(
      exportTransferWorkspace({ ...exported, path: projectPath }, source),
    ).rejects.toThrow(/another workspace/);
    for (const file of ["git", "session"] as const) {
      const chunk = await readTransferChunk(
        { type: "workspace.transfer.read", operationId, file, offset: 0 },
        source,
      );
      expect(chunk.done).toBe(true);
      const write = {
        type: "workspace.transfer.write" as const,
        operationId,
        file,
        offset: 0,
        data: chunk.data,
      };
      expect(await writeTransferChunk(write, destination)).toEqual({
        nextOffset: chunk.nextOffset,
      });
      expect(await writeTransferChunk(write, destination)).toEqual({
        nextOffset: chunk.nextOffset,
      });
      await expect(
        writeTransferChunk({ ...write, data: "eHl6" }, destination),
      ).rejects.toThrow(/different transfer chunk/);
    }
    const restore = {
      type: "workspace.transfer.restore" as const,
      operationId,
      projectPath,
      manifest,
      targetProviderThreadId: randomUUID(),
      sessionHome,
    };
    const result = await restoreTransferWorkspace(restore, destination);
    expect(await restoreTransferWorkspace(restore, destination)).toEqual(
      result,
    );
    expect(
      await readFile(path.join(result.workspacePath, "file.txt"), "utf8"),
    ).toBe("working");
    expect(
      (await runGit(["show", ":file.txt"], { cwd: result.workspacePath }))
        .stdout,
    ).toBe("staged");
    expect(await readFile(path.join(projectPath, "file.txt"), "utf8")).toBe(
      "original",
    );
    const transferred = await readFile(
      path.join(
        destination.codexHomes[sessionHome],
        "sessions/2026/09/15",
        `rollout-2026-09-15-${result.providerThreadId}.jsonl`,
      ),
      "utf8",
    );
    expect(transferred).toContain("Keep native context");
    expect(JSON.parse(transferred.split("\n")[0]!).payload).toMatchObject({
      id: result.providerThreadId,
      cwd: result.workspacePath,
    });
    const receiptPath = path.join(
      destination.dataDir,
      "workspace-transfers",
      "incoming",
      operationId,
      "receipt.json",
    );
    await rm(receiptPath);
    expect(await restoreTransferWorkspace(restore, destination)).toEqual(
      result,
    );
    await rm(receiptPath);
    await writeFile(
      path.join(result.workspacePath, "file.txt"),
      "later user edit",
    );
    await expect(
      restoreTransferWorkspace(restore, destination),
    ).rejects.toThrow(/worktree has changed/);
    expect(
      await readFile(path.join(result.workspacePath, "file.txt"), "utf8"),
    ).toBe("later user edit");
  },
);

it("repairs a partial final chunk only when its saved prefix matches", async () => {
  const dataDir = await mkdtemp(path.join(tmpdir(), "kaioken-handoff-chunk-"));
  directories.push(dataDir);
  const operationId = randomUUID();
  const directory = path.join(
    dataDir,
    "workspace-transfers",
    "incoming",
    operationId,
  );
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "workspace.bundle"), "abc");
  const options = {
    dataDir,
    runtimeManager: { getShellEnv: () => ({ PATH: process.env.PATH ?? "" }) },
  };
  const command = {
    type: "workspace.transfer.write" as const,
    operationId,
    file: "git" as const,
    offset: 0,
    data: Buffer.from("abcdef").toString("base64"),
  };
  expect(await writeTransferChunk(command, options)).toEqual({ nextOffset: 6 });
  expect(await readFile(path.join(directory, "workspace.bundle"), "utf8")).toBe(
    "abcdef",
  );
  await expect(
    writeTransferChunk({ ...command, offset: 10 }, options),
  ).rejects.toThrow(/in order/);
});
