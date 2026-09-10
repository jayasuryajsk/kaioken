import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmod,
  copyFile,
  cp,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { HOST_DAEMON_PROTOCOL_VERSION } from "@kaioken/host-daemon-contract";

const execFileAsync = promisify(execFile);
const HOST_DEPENDENCIES = [
  "@parcel/watcher",
  "node-pty",
  "pino",
  "pino-pretty",
  "pino-roll",
] as const;
const HOST_DAEMON_FILES = [
  "kaioken",
  "kaioken-parcel-watcher-child.mjs",
  "kaioken-plugin-host-worker.mjs",
  "kaioken-provider-bridge-worker.mjs",
  "daemon-bundle.mjs",
] as const;

export interface KaiokenAppArtifact {
  digest: string;
  path: string;
  size: number;
}

export interface KaiokenAppArtifactService {
  getArtifact(): Promise<KaiokenAppArtifact>;
  getVersion(): Promise<string>;
}

export interface KaiokenAppArtifactCommandRunner {
  (command: string, args: readonly string[], cwd: string): Promise<string>;
}

interface CreateBbAppArtifactServiceOptions {
  dataDir: string;
  commandRunner?: KaiokenAppArtifactCommandRunner;
  protocolVersion?: number;
  serverEntryUrl?: string;
}

interface KaiokenAppPackageJson {
  dependencies: Record<string, string>;
  engines: { node: string };
  name: "kaioken-app";
  os: string[];
  version: string;
}

async function defaultCommandRunner(
  command: string,
  args: readonly string[],
  cwd: string,
): Promise<string> {
  const result = await execFileAsync(command, [...args], {
    cwd,
    maxBuffer: 10 * 1024 * 1024,
  });
  return result.stdout;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return (
    value !== null &&
    typeof value === "object" &&
    Object.values(value).every((entry) => typeof entry === "string")
  );
}

async function readBbAppPackageJson(
  packageRoot: string,
): Promise<KaiokenAppPackageJson> {
  const parsed: unknown = JSON.parse(
    await readFile(join(packageRoot, "package.json"), "utf8"),
  );
  if (
    parsed === null ||
    typeof parsed !== "object" ||
    !("name" in parsed) ||
    parsed.name !== "kaioken-app" ||
    !("version" in parsed) ||
    typeof parsed.version !== "string" ||
    !("dependencies" in parsed) ||
    !isStringRecord(parsed.dependencies) ||
    !("engines" in parsed) ||
    parsed.engines === null ||
    typeof parsed.engines !== "object" ||
    !("node" in parsed.engines) ||
    typeof parsed.engines.node !== "string" ||
    !("os" in parsed) ||
    !Array.isArray(parsed.os) ||
    !parsed.os.every((entry) => typeof entry === "string")
  ) {
    throw new Error(`Expected a kaioken-app package at ${packageRoot}`);
  }
  return {
    dependencies: parsed.dependencies,
    engines: { node: parsed.engines.node },
    name: parsed.name,
    os: parsed.os,
    version: parsed.version,
  };
}

interface ResolvedBbAppPackage {
  layout: "packaged" | "repo";
  packageJson: KaiokenAppPackageJson;
  root: string;
}

export async function resolveBbAppPackage(
  serverEntryUrl: string,
): Promise<ResolvedBbAppPackage> {
  const serverEntryDir = dirname(fileURLToPath(serverEntryUrl));
  const candidates: readonly { layout: "packaged" | "repo"; root: string }[] = [
    { layout: "packaged", root: resolve(serverEntryDir, "../..") },
    {
      layout: "repo",
      root: resolve(serverEntryDir, "../../../packages/kaioken-app"),
    },
  ];
  for (const candidate of candidates) {
    try {
      const packageJson = await readBbAppPackageJson(candidate.root);
      return { ...candidate, packageJson };
    } catch {}
  }
  throw new Error(
    `Unable to locate the kaioken-app package from ${serverEntryDir}; tried ${candidates
      .map((candidate) => candidate.root)
      .join(", ")}`,
  );
}

function hostPackageJson(packageJson: KaiokenAppPackageJson): object {
  const dependencies = Object.fromEntries(
    HOST_DEPENDENCIES.map((name) => {
      const version = packageJson.dependencies[name];
      if (version === undefined) {
        throw new Error(`kaioken-app is missing host dependency ${name}`);
      }
      return [name, version];
    }),
  );
  return {
    name: packageJson.name,
    version: packageJson.version,
    description: "kaioken enrolled host runtime",
    type: "module",
    os: packageJson.os,
    bin: {
      bb: "dist/kaioken.js",
      "kaioken-app": "dist/kaioken-app.js",
      "kaioken-host-daemon": "dist/kaioken-host-daemon.js",
    },
    files: ["dist", "host-daemon", "README.md"],
    engines: packageJson.engines,
    dependencies,
  };
}

async function materializePackagedHostPackage(
  packageRoot: string,
  packageJson: KaiokenAppPackageJson,
  cacheDir: string,
): Promise<string> {
  const hostPackageRoot = await mkdtemp(join(cacheDir, "host-package-"));
  const distDir = join(hostPackageRoot, "dist");
  const hostDaemonSource = join(packageRoot, "host-daemon", "dist");
  const hostDaemonTarget = join(hostPackageRoot, "host-daemon", "dist");
  await mkdir(hostDaemonTarget, { recursive: true });
  await mkdir(distDir, { recursive: true });
  for (const fileName of ["kaioken-app.js", "kaioken-host-daemon.js", "kaioken.js"]) {
    await copyFile(
      join(packageRoot, "dist", fileName),
      join(distDir, fileName),
    );
    await chmod(join(distDir, fileName), 0o755);
  }
  for (const fileName of HOST_DAEMON_FILES) {
    await copyFile(
      join(hostDaemonSource, fileName),
      join(hostDaemonTarget, fileName),
    );
  }
  await chmod(join(hostDaemonTarget, "kaioken"), 0o755);
  await cp(
    join(hostDaemonSource, "kaioken-chunks"),
    join(hostDaemonTarget, "kaioken-chunks"),
    { recursive: true },
  );
  try {
    await copyFile(
      join(packageRoot, "README.md"),
      join(hostPackageRoot, "README.md"),
    );
  } catch (error) {
    if (
      !(error instanceof Error && "code" in error && error.code === "ENOENT")
    ) {
      throw error;
    }
  }
  await writeFile(
    join(hostPackageRoot, "package.json"),
    `${JSON.stringify(hostPackageJson(packageJson), null, 2)}\n`,
  );
  return hostPackageRoot;
}

function sha256(bytes: Uint8Array): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export function createBbAppArtifactService(
  options: CreateBbAppArtifactServiceOptions,
): KaiokenAppArtifactService {
  const commandRunner = options.commandRunner ?? defaultCommandRunner;
  const serverEntryUrl = options.serverEntryUrl ?? import.meta.url;
  const cacheDir = join(options.dataDir, "install-cache");
  const protocolVersion =
    options.protocolVersion ?? HOST_DAEMON_PROTOCOL_VERSION;
  let resolvedPackagePromise: Promise<ResolvedBbAppPackage> | undefined;
  let artifactPromise: Promise<KaiokenAppArtifact> | undefined;

  function getResolvedPackage(): Promise<ResolvedBbAppPackage> {
    resolvedPackagePromise ??= resolveBbAppPackage(serverEntryUrl);
    return resolvedPackagePromise;
  }

  async function buildArtifact(): Promise<KaiokenAppArtifact> {
    const resolved = await getResolvedPackage();
    const { packageJson, root: packageRoot } = resolved;
    await mkdir(cacheDir, { recursive: true });
    let temporaryHostPackageRoot: string | undefined;
    let hostPackageRoot: string;
    if (resolved.layout === "repo") {
      const repoRoot = resolve(packageRoot, "../..");
      await commandRunner(
        "pnpm",
        ["exec", "turbo", "run", "build:host", "--filter=kaioken-app"],
        repoRoot,
      );
      hostPackageRoot = join(packageRoot, "host-package");
    } else {
      temporaryHostPackageRoot = await materializePackagedHostPackage(
        packageRoot,
        packageJson,
        cacheDir,
      );
      hostPackageRoot = temporaryHostPackageRoot;
    }

    try {
      const stdout = await commandRunner(
        "npm",
        ["pack", "--pack-destination", cacheDir],
        hostPackageRoot,
      );
      const packedName = stdout.trim().split(/\r?\n/u).at(-1);
      if (!packedName) {
        throw new Error("npm pack did not report a tarball name");
      }
      const packedPath = join(cacheDir, packedName);
      const bytes = await readFile(packedPath);
      const digest = sha256(bytes);
      const artifactPath = join(
        cacheDir,
        `kaioken-app-host-${packageJson.version}-protocol-${protocolVersion}-${digest}.tgz`,
      );
      await rename(packedPath, artifactPath);
      const artifactStats = await stat(artifactPath);
      return { digest, path: artifactPath, size: artifactStats.size };
    } finally {
      if (temporaryHostPackageRoot !== undefined) {
        await rm(temporaryHostPackageRoot, { force: true, recursive: true });
      }
    }
  }

  return {
    getArtifact(): Promise<KaiokenAppArtifact> {
      artifactPromise ??= buildArtifact().catch((error: unknown) => {
        artifactPromise = undefined;
        throw error;
      });
      return artifactPromise;
    },
    async getVersion(): Promise<string> {
      return (await getResolvedPackage()).packageJson.version;
    },
  };
}
