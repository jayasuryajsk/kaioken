import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  resolveDevInstanceConfig,
  resolveInheritedDevSkillsRootPaths,
  toDevProcessEnv,
} from "@kaioken/config/runtime";
import {
  createDevTurboCommand,
  createStartWorktreeCommand,
  resolveDevLaunchMode,
  toDevLaunchProcessEnv,
} from "../src/commands/run-dev.js";
import { migrateLegacyDevData } from "../src/lib/legacy-dev-data-migration.js";
import {
  expectedDevDataDir,
  expectedDevInstanceId,
  expectedDevPorts,
  expectedDevServerUrl,
} from "./dev-instance-expectations.js";

const tempDirs: string[] = [];

async function makeTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function pathExists(pathToCheck: string): Promise<boolean> {
  try {
    await fs.access(pathToCheck);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("run-dev", () => {
  it("derives stable data and ports from a managed checkout", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/.kaioken-dev/projects/env_q7e5i54kxt/kaioken";
    const config = resolveDevInstanceConfig({ homeDir, repoRoot });

    expect(config.instanceId).toBe(
      expectedDevInstanceId({ homeDir, repoRoot }),
    );
    expect(config.dataDir).toBe(expectedDevDataDir({ homeDir, repoRoot }));
    expect(config.ports).toEqual(expectedDevPorts(repoRoot));
    expect(config.serverUrl).toBe(expectedDevServerUrl(repoRoot));
    expect(new Set(Object.values(config.ports))).toHaveLength(5);
    expect(Object.values(config.ports)).not.toContain(5173);
    expect(Object.values(config.ports)).not.toContain(3334);
    expect(Object.values(config.ports)).not.toContain(3002);
    expect(Object.values(config.ports)).not.toContain(38886);
    expect(Object.values(config.ports)).not.toContain(38887);
  });

  it("keeps Cloud gateway ports out of the worker band and packaged ports", () => {
    const rootsByOffset = new Map([
      [0, "/repo/port-13604"],
      [1, "/repo/port-3079"],
      [3886, "/repo/port-3186"],
      [3887, "/repo/port-6427"],
      [7998, "/repo/port-57923"],
      [7999, "/repo/port-7517"],
    ]);
    const portsByOffset = new Map(
      [...rootsByOffset].map(([offset, repoRoot]) => [
        offset,
        resolveDevInstanceConfig({ homeDir: "/Users/tester", repoRoot }).ports,
      ]),
    );

    expect(portsByOffset.get(3886)?.cloudPort).toBe(59000);
    expect(portsByOffset.get(3887)?.cloudPort).toBe(59001);
    expect(portsByOffset.get(7998)?.cloudPort).toBe(42998);
    expect(portsByOffset.get(7999)?.cloudPort).toBe(42999);
    expect(portsByOffset.get(0)?.cloudWorkerPort).toBe(43000);
    expect(portsByOffset.get(1)?.cloudWorkerPort).toBe(43001);
    expect(
      new Set(
        [...portsByOffset.values()].flatMap(
          ({ cloudPort, cloudWorkerPort }) => [cloudPort, cloudWorkerPort],
        ),
      ),
    ).toHaveLength(rootsByOffset.size * 2);
  });

  it("uses the home-relative checkout path for non-managed checkout paths", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/src/work/kaioken-feature-copy";

    const config = resolveDevInstanceConfig({ homeDir, repoRoot });

    expect(config.instanceId).toBe(
      expectedDevInstanceId({ homeDir, repoRoot }),
    );
  });

  it("overrides instance selectors while preserving unrelated environment", () => {
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot: "/Users/tester/.kaioken-dev/projects/env_q7e5i54kxt/kaioken",
    });
    const baseEnv: NodeJS.ProcessEnv = {
      KAIOKEN_DATA_DIR: "/Users/tester/.kaioken-dev",
      KAIOKEN_SERVER_PORT: "3334",
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key",
    };

    const env = toDevProcessEnv({ baseEnv, config });

    expect(env.OPENAI_API_KEY).toBe("test-key");
    expect(env.NODE_ENV).toBe("development");
    expect(env.KAIOKEN_DATA_DIR).toBe(config.dataDir);
    expect(env.KAIOKEN_SERVER_PORT).toBe(String(config.ports.serverPort));
    expect(env.KAIOKEN_SERVER_URL).toBe(config.serverUrl);
    expect(env.KAIOKEN_HOST_DAEMON_PORT).toBe(String(config.ports.hostDaemonPort));
    expect(env.KAIOKEN_DEV_APP_PORT).toBe(String(config.ports.appPort));
    expect(env.KAIOKEN_DEV_CONNECT_BASE_URL).toBe(
      `http://kaioken.localhost:${config.ports.cloudPort}`,
    );
  });

  it("inherits parent kaioken skills for managed worktree dev apps", () => {
    const homeDir = "/Users/tester";
    const repoRoot =
      "/Users/tester/.kaioken-dev/code-kaioken-abc123/worktrees/env_feature/kaioken";
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot,
    });

    const inheritedSkillsRootPaths = [
      "/Users/tester/.kaioken-dev/code-kaioken-abc123/skills",
      "/Users/tester/.kaioken/skills",
    ];
    expect(resolveInheritedDevSkillsRootPaths({ homeDir, repoRoot })).toEqual(
      inheritedSkillsRootPaths,
    );
    expect(toDevProcessEnv({ baseEnv: {}, config })).toMatchObject({
      KAIOKEN_INHERITED_SKILLS_ROOTS: inheritedSkillsRootPaths.join(path.delimiter),
    });
  });

  it("dedupes inherited kaioken skills for prod-managed worktree dev apps", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/.kaioken/worktrees/env_feature/kaioken";
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot,
    });

    expect(resolveInheritedDevSkillsRootPaths({ homeDir, repoRoot })).toEqual([
      "/Users/tester/.kaioken/skills",
    ]);
    expect(toDevProcessEnv({ baseEnv: {}, config })).toMatchObject({
      KAIOKEN_INHERITED_SKILLS_ROOTS: "/Users/tester/.kaioken/skills",
    });
  });

  it("inherits prod kaioken skills for ordinary checkout dev apps", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/src/kaioken";
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot,
    });

    expect(resolveInheritedDevSkillsRootPaths({ homeDir, repoRoot })).toEqual([
      "/Users/tester/.kaioken/skills",
    ]);
    expect(toDevProcessEnv({ baseEnv: {}, config })).toMatchObject({
      KAIOKEN_INHERITED_SKILLS_ROOTS: "/Users/tester/.kaioken/skills",
    });
  });

  it("strips parent thread context from dev child processes", () => {
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot: "/Users/tester/src/kaioken",
    });
    const baseEnv: NodeJS.ProcessEnv = {
      KAIOKEN_ENVIRONMENT_ID: "env_parent",
      KAIOKEN_PROJECT_ID: "proj_parent",
      KAIOKEN_THREAD_ID: "thr_parent",
      KAIOKEN_THREAD_STORAGE: "/Users/tester/.kaioken/thread-storage/thr_parent",
    };

    const env = toDevProcessEnv({ baseEnv, config });

    expect(env.KAIOKEN_ENVIRONMENT_ID).toBeUndefined();
    expect(env.KAIOKEN_THREAD_ID).toBeUndefined();
    expect(env.KAIOKEN_THREAD_STORAGE).toBeUndefined();
    expect(env.KAIOKEN_PROJECT_ID).toBe("proj_parent");
  });

  it("runs the same persistent dev tasks as pnpm dev", () => {
    expect(createDevTurboCommand()).toEqual({
      args: [
        "exec",
        "turbo",
        "run",
        "dev",
        "--filter=@kaioken/app",
        "--filter=@kaioken/server",
        "--filter=@kaioken/host-daemon",
        "--ui",
        "tui",
        "--concurrency",
        "20",
        "--no-update-notifier",
      ],
      command: "pnpm",
    });
  });

  it("runs the production-style source launcher for worktree start", () => {
    const command = createStartWorktreeCommand();

    expect(command.command).toBe(process.execPath);
    expect(command.args).toEqual([
      "--conditions=source",
      "--import",
      "tsx",
      path.resolve(import.meta.dirname, "../../..", "scripts/start-kaioken.mjs"),
      "--worktree-runtime-policy",
    ]);
  });

  it("accepts only the supported dev launch mode", () => {
    expect(resolveDevLaunchMode([])).toBe("vite");
    expect(resolveDevLaunchMode(["--worktree"])).toBe("worktree");
    expect(() => resolveDevLaunchMode(["--watch"])).toThrow(
      "Expected no arguments or --worktree",
    );
  });

  it("uses production serving with checkout-specific dev selectors", () => {
    const config = resolveDevInstanceConfig({
      homeDir: "/Users/tester",
      repoRoot: "/Users/tester/src/kaioken",
    });

    const env = toDevLaunchProcessEnv({
      baseEnv: {
        KAIOKEN_DATA_DIR: "/Users/tester/.kaioken",
        KAIOKEN_DEV_APP_PORT: "5173",
        KAIOKEN_TELEMETRY: "true",
        NODE_ENV: "development",
        OPENAI_API_KEY: "test-key",
      },
      config,
      mode: "worktree",
    });

    expect(env).toMatchObject({
      KAIOKEN_DATA_DIR: config.dataDir,
      KAIOKEN_HOST_DAEMON_PORT: String(config.ports.hostDaemonPort),
      KAIOKEN_SERVER_PORT: String(config.ports.serverPort),
      KAIOKEN_SERVER_URL: config.serverUrl,
      KAIOKEN_TELEMETRY: "false",
      NODE_ENV: "production",
      OPENAI_API_KEY: "test-key",
    });
    expect(env.KAIOKEN_DEV_APP_PORT).toBeUndefined();
  });

  it("migrates legacy flat dev data into the checkout instance", async () => {
    const homeDir = await makeTempDir("kaioken-dev-home-");
    const legacyDataDir = path.join(homeDir, ".kaioken-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "kaioken"),
    });
    await fs.mkdir(path.join(legacyDataDir, "logs"), { recursive: true });
    await fs.mkdir(path.join(legacyDataDir, "attachments", "proj_test"), {
      recursive: true,
    });
    await fs.mkdir(path.join(legacyDataDir, "worktrees", "env_old", "kaioken"), {
      recursive: true,
    });
    await fs.mkdir(path.join(legacyDataDir, "dev-supervisors"), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyDataDir, "kaioken.db"), "db", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "kaioken.db.backup-20260515-160305"),
      "backup",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "auth-secret"),
      "secret",
      "utf8",
    );
    await fs.writeFile(
      path.join(legacyDataDir, "attachments", "proj_test", "screenshot.png"),
      "image",
      "utf8",
    );
    await fs.writeFile(path.join(legacyDataDir, "daemon.lock"), "lock", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "dev-supervisors", "server.pid"),
      "not-a-pid",
      "utf8",
    );
    const output = { write: vi.fn() };

    const result = await migrateLegacyDevData({ config, output });

    expect(result).toEqual({
      migratedEntries: [
        "attachments",
        "auth-secret",
        "kaioken.db",
        "kaioken.db.backup-20260515-160305",
        "logs",
      ],
    });
    await expect(
      fs.readFile(path.join(config.dataDir, "kaioken.db"), "utf8"),
    ).resolves.toBe("db");
    await expect(
      fs.readFile(path.join(config.dataDir, "auth-secret"), "utf8"),
    ).resolves.toBe("secret");
    await expect(
      fs.readFile(
        path.join(config.dataDir, "attachments", "proj_test", "screenshot.png"),
        "utf8",
      ),
    ).resolves.toBe("image");
    await expect(
      fs.access(path.join(legacyDataDir, "worktrees", "env_old", "kaioken")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacyDataDir, "dev-supervisors", "server.pid")),
    ).resolves.toBeUndefined();
    await expect(
      fs.access(path.join(legacyDataDir, "daemon.lock")),
    ).resolves.toBeUndefined();
    expect(output.write).toHaveBeenCalledWith(
      expect.stringContaining(
        `Migrated legacy dev data into ${config.dataDir}`,
      ),
    );
  });

  it("skips migration when the target instance already has data", async () => {
    const homeDir = await makeTempDir("kaioken-dev-home-");
    const legacyDataDir = path.join(homeDir, ".kaioken-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "kaioken"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.mkdir(config.dataDir, { recursive: true });
    await fs.writeFile(path.join(legacyDataDir, "kaioken.db"), "legacy", "utf8");
    await fs.writeFile(path.join(config.dataDir, "kaioken.db"), "target", "utf8");

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "target-exists",
    });
    await expect(
      fs.readFile(path.join(legacyDataDir, "kaioken.db"), "utf8"),
    ).resolves.toBe("legacy");
    await expect(
      fs.readFile(path.join(config.dataDir, "kaioken.db"), "utf8"),
    ).resolves.toBe("target");
  });

  it("skips migration when legacy dev data is absent", async () => {
    const homeDir = await makeTempDir("kaioken-dev-home-");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "kaioken"),
    });

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-data-not-found",
    });
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("skips migration when legacy dev data has no migratable entries", async () => {
    const homeDir = await makeTempDir("kaioken-dev-home-");
    const legacyDataDir = path.join(homeDir, ".kaioken-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "kaioken"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(path.join(legacyDataDir, "daemon.lock"), "lock", "utf8");

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-data-empty",
    });
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("rolls back already moved entries when migration rename fails", async () => {
    const homeDir = await makeTempDir("kaioken-dev-home-");
    const legacyDataDir = path.join(homeDir, ".kaioken-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "kaioken"),
    });
    await fs.mkdir(legacyDataDir, { recursive: true });
    await fs.writeFile(
      path.join(legacyDataDir, "auth-secret"),
      "secret",
      "utf8",
    );
    await fs.writeFile(path.join(legacyDataDir, "kaioken.db"), "db", "utf8");
    const renameCalls: string[] = [];
    const renameWithInjectedFailure = vi.fn(
      async (sourcePath: string, targetPath: string): Promise<void> => {
        renameCalls.push(path.basename(sourcePath));
        if (renameCalls.length === 1) {
          await fs.rename(sourcePath, targetPath);
          return;
        }

        throw new Error("injected rename failure");
      },
    );

    await expect(
      migrateLegacyDevData({
        config,
        dependencies: {
          rename: renameWithInjectedFailure,
        },
      }),
    ).rejects.toThrow("injected rename failure");

    expect(renameCalls).toEqual(["auth-secret", "kaioken.db"]);
    await expect(
      fs.readFile(path.join(legacyDataDir, "auth-secret"), "utf8"),
    ).resolves.toBe("secret");
    await expect(
      fs.readFile(path.join(legacyDataDir, "kaioken.db"), "utf8"),
    ).resolves.toBe("db");
    expect(await pathExists(config.dataDir)).toBe(false);
  });

  it("does not migrate legacy data while a legacy dev supervisor is running", async () => {
    const homeDir = await makeTempDir("kaioken-dev-home-");
    const legacyDataDir = path.join(homeDir, ".kaioken-dev");
    const config = resolveDevInstanceConfig({
      homeDir,
      repoRoot: path.join(homeDir, "src", "kaioken"),
    });
    await fs.mkdir(path.join(legacyDataDir, "dev-supervisors"), {
      recursive: true,
    });
    await fs.writeFile(path.join(legacyDataDir, "kaioken.db"), "db", "utf8");
    await fs.writeFile(
      path.join(legacyDataDir, "dev-supervisors", "server.pid"),
      `${process.pid}\n`,
      "utf8",
    );

    await expect(migrateLegacyDevData({ config })).resolves.toEqual({
      migratedEntries: [],
      skippedReason: "legacy-dev-process-running",
    });
    await expect(
      fs.readFile(path.join(legacyDataDir, "kaioken.db"), "utf8"),
    ).resolves.toBe("db");
    expect(await pathExists(config.dataDir)).toBe(false);
  });
});
