import { execFile, spawn } from "node:child_process";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const MINIMUM_NODE_MAJOR = 22;

async function findNewerNode() {
  const nvmVersionsDir = join(
    process.env.HOME ?? "",
    ".nvm",
    "versions",
    "node",
  );
  const entries = await readdir(nvmVersionsDir).catch(() => []);
  const candidates = entries
    .map((name) => /^v(\d+)\.(\d+)\.(\d+)$/u.exec(name))
    .filter((match) => match !== null)
    .map((match) => ({
      name: match[0],
      parts: [Number(match[1]), Number(match[2]), Number(match[3])],
    }))
    .filter(({ parts }) => parts[0] >= MINIMUM_NODE_MAJOR)
    .sort((a, b) => {
      for (let index = 0; index < 3; index += 1) {
        if (a.parts[index] !== b.parts[index])
          return b.parts[index] - a.parts[index];
      }
      return 0;
    });
  const best = candidates[0];
  return best === undefined ? null : join(nvmVersionsDir, best.name, "bin");
}

async function ensureSupportedNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major >= MINIMUM_NODE_MAJOR) return false;
  const binDir = await findNewerNode();
  if (binDir === null) {
    throw new Error(
      `Node ${process.versions.node} is too old for the desktop build; install Node ${MINIMUM_NODE_MAJOR}+ (for example via nvm) and retry.`,
    );
  }
  console.log(
    `Node ${process.versions.node} is too old for the desktop build; re-running with ${binDir}.`,
  );
  const child = spawn(join(binDir, "node"), process.argv.slice(1), {
    cwd: process.cwd(),
    env: { ...process.env, PATH: `${binDir}:${process.env.PATH ?? ""}` },
    stdio: "inherit",
  });
  const code = await new Promise((resolvePromise) =>
    child.on("close", resolvePromise),
  );
  process.exit(code ?? 1);
}
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const desktopRoot = join(repoRoot, "apps", "desktop");
const releaseDir = join(desktopRoot, "release");
const LATEST_TAG = "desktop-latest";
const RELEASE_ENV_FILE = join(repoRoot, ".env.release");
const DEVELOPER_ID_PREFIX = "Developer ID Application:";
const USAGE =
  "Usage: pnpm release:desktop <version>|--patch|--minor|--major [--notes <text>] [--dry-run] [--skip-build] [--single-upload]\n       pnpm release:desktop --publish-only [--notes <text>]   (retry the GitHub release for the current version)\n       --single-upload keeps the zip on the versioned release only; safe once every install runs 1.0.3 or newer";

function parseArgs(argv) {
  const options = {
    version: null,
    notes: null,
    dryRun: false,
    skipBuild: false,
    publishOnly: false,
    singleUpload: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--publish-only") options.publishOnly = true;
    else if (arg === "--single-upload") options.singleUpload = true;
    else if (arg === "--skip-build") options.skipBuild = true;
    else if (arg === "--notes") {
      options.notes = argv[index + 1] ?? null;
      index += 1;
    } else if (options.version === null) options.version = arg;
    else throw new Error(USAGE);
  }
  if (options.version === null && !options.publishOnly) throw new Error(USAGE);
  return options;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? repoRoot,
      env: { ...process.env, ...(options.env ?? {}) },
      stdio: "inherit",
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolvePromise();
      else
        reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

let githubRepo = null;

async function resolveGithubRepo() {
  if (githubRepo !== null) return githubRepo;
  const url = await capture("git", ["remote", "get-url", "origin"]);
  const match = /github\.com[:/]([^/]+)\/([^/.]+)(?:\.git)?$/u.exec(url);
  if (match === null) {
    throw new Error(`Cannot derive a GitHub repo from origin url ${url}`);
  }
  githubRepo = `${match[1]}/${match[2]}`;
  return githubRepo;
}

async function gh(args, { capture: captureOutput = false } = {}) {
  const repo = await resolveGithubRepo();
  const fullArgs = [args[0], ...args.slice(1), "--repo", repo];
  if (captureOutput) return capture("gh", fullArgs);
  await run("gh", fullArgs);
  return "";
}

async function capture(command, args, cwd = repoRoot) {
  const { stdout } = await execFileAsync(command, args, { cwd });
  return stdout.trim();
}

async function loadReleaseEnv() {
  let text;
  try {
    text = await readFile(RELEASE_ENV_FILE, "utf8");
  } catch {
    return {};
  }
  const loaded = {};
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) loaded[key] = value;
  }
  return loaded;
}

async function findDeveloperIdIdentity() {
  try {
    const output = await capture("security", [
      "find-identity",
      "-v",
      "-p",
      "codesigning",
    ]);
    const line = output
      .split("\n")
      .find((candidate) => candidate.includes(DEVELOPER_ID_PREFIX));
    if (line === undefined) return null;
    const match = /"([^"]+)"/u.exec(line);
    return match === null ? null : match[1];
  } catch {
    return null;
  }
}

async function describeSigning() {
  const releaseEnv = await loadReleaseEnv();
  const identity = await findDeveloperIdIdentity();
  const appleKeys = [
    "APPLE_ID",
    "APPLE_APP_SPECIFIC_PASSWORD",
    "APPLE_TEAM_ID",
  ];
  const hasAppleCredentials = appleKeys.every(
    (key) => (process.env[key] ?? releaseEnv[key] ?? "").length > 0,
  );
  if (identity === null) {
    return {
      env: { CSC_IDENTITY_AUTO_DISCOVERY: "false" },
      summary:
        "unsigned (no Developer ID Application identity in the keychain)",
    };
  }
  if (!hasAppleCredentials) {
    return {
      env: { ...releaseEnv, CSC_IDENTITY_AUTO_DISCOVERY: "true" },
      summary: `signed with ${identity}, not notarized (add APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID to ${RELEASE_ENV_FILE})`,
    };
  }
  return {
    env: { ...releaseEnv, CSC_IDENTITY_AUTO_DISCOVERY: "true" },
    summary: `signed with ${identity} and notarized`,
  };
}

async function readDesktopVersion() {
  const packageJson = JSON.parse(
    await readFile(join(desktopRoot, "package.json"), "utf8"),
  );
  return packageJson.version;
}

async function assertReadyToRelease() {
  const branch = await capture("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
  if (branch !== "main") {
    throw new Error(`Releases ship from main; currently on ${branch}.`);
  }
  const status = await capture("git", ["status", "--porcelain"]);
  if (status.length > 0) {
    throw new Error("Working tree is not clean; commit or stash first.");
  }
  await capture("gh", ["auth", "status"]);
}

async function collectAssets(version) {
  const names = await readdir(releaseDir).catch(() => []);
  const wanted = names.filter(
    (name) =>
      (name.includes(version) &&
        (name.endsWith(".zip") || name.endsWith(".blockmap"))) ||
      name === "latest-mac.yml" ||
      name === "desktop-version.json",
  );
  const missing = ["latest-mac.yml", "desktop-version.json"].filter(
    (name) => !wanted.includes(name),
  );
  if (missing.length > 0 || !wanted.some((name) => name.endsWith(".zip"))) {
    throw new Error(
      `Release assets incomplete in ${releaseDir}: have ${wanted.join(", ") || "nothing"}`,
    );
  }
  return wanted.map((name) => join(releaseDir, name));
}

async function releaseExists(tag) {
  try {
    await gh(["release", "view", tag], { capture: true });
    return true;
  } catch {
    return false;
  }
}

async function pointFeedAtVersionedRelease(assets, versionTag) {
  const repo = await resolveGithubRepo();
  const feedPath = assets.find((asset) =>
    asset.endsWith("desktop-version.json"),
  );
  if (feedPath === undefined) return;
  const feed = JSON.parse(await readFile(feedPath, "utf8"));
  const base = `https://github.com/${repo}/releases/download/${versionTag}/`;
  const absolute = (name) =>
    /^https?:\/\//u.test(name) ? name : new URL(name, base).toString();
  feed.files = feed.files.map((file) => ({ ...file, url: absolute(file.url) }));
  feed.path = absolute(feed.path);
  await writeFile(feedPath, `${JSON.stringify(feed, null, 2)}\n`);
}

function isBinaryAsset(asset) {
  return asset.endsWith(".zip") || asset.endsWith(".blockmap");
}

async function publishReleases({ version, sha, assets, notes, singleUpload }) {
  const versionTag = `desktop-v${version}`;
  if (singleUpload) await pointFeedAtVersionedRelease(assets, versionTag);
  const latestAssets = singleUpload
    ? assets.filter((asset) => !isBinaryAsset(asset))
    : assets;
  if (!(await releaseExists(versionTag))) {
    await gh([
      "release",
      "create",
      versionTag,
      ...assets,
      "--target",
      sha,
      "--title",
      `Kaioken desktop ${version}`,
      "--notes",
      notes,
      "--latest",
    ]);
  } else {
    console.log(
      `Release ${versionTag} already exists; refreshing ${LATEST_TAG} only.`,
    );
  }

  if (await releaseExists(LATEST_TAG)) {
    await gh([
      "release",
      "edit",
      LATEST_TAG,
      "--target",
      sha,
      "--title",
      "Kaioken desktop latest",
      "--notes",
      "Moving release that serves the desktop auto-update feed.",
      "--latest=false",
    ]);
    const existing = await gh(
      [
        "release",
        "view",
        LATEST_TAG,
        "--json",
        "assets",
        "--jq",
        ".assets[].name",
      ],
      { capture: true },
    );
    for (const name of existing.split("\n").filter((line) => line.length > 0)) {
      await gh(["release", "delete-asset", LATEST_TAG, name, "--yes"]);
    }
    await gh(["release", "upload", LATEST_TAG, ...latestAssets]);
  } else {
    await gh([
      "release",
      "create",
      LATEST_TAG,
      ...latestAssets,
      "--target",
      sha,
      "--title",
      "Kaioken desktop latest",
      "--notes",
      "Moving release that serves the desktop auto-update feed.",
      "--latest=false",
    ]);
  }
  console.log(
    `Published ${versionTag}. Running Kaioken installs pick it up on their next update check.`,
  );
}

async function restoreVersionFiles() {
  await run("git", [
    "checkout",
    "--",
    "apps/desktop/package.json",
    "packages/kaioken-app/package.json",
  ]);
}

async function main() {
  await ensureSupportedNode();
  const options = parseArgs(process.argv.slice(2));

  if (options.publishOnly) {
    await capture("gh", ["auth", "status"]);
    const version = await readDesktopVersion();
    const sha = await capture("git", [
      "rev-list",
      "-n",
      "1",
      `desktop-v${version}`,
    ]);
    const assets = await collectAssets(version);
    await publishReleases({
      version,
      sha,
      assets,
      notes: options.notes ?? `Kaioken desktop ${version}`,
      singleUpload: options.singleUpload,
    });
    return;
  }

  await assertReadyToRelease();

  const previousVersion = await readDesktopVersion();
  await run("node", [
    join(repoRoot, "scripts", "bump-version.mjs"),
    options.version,
  ]);
  const version = await readDesktopVersion();
  const versionTag = `desktop-v${version}`;
  if (await releaseExists(versionTag)) {
    await restoreVersionFiles();
    throw new Error(
      `Release ${versionTag} already exists; pick a new version.`,
    );
  }
  console.log(`Releasing Kaioken desktop ${previousVersion} → ${version}`);

  let assets;
  try {
    if (!options.skipBuild) {
      const signing = await describeSigning();
      console.log(`Signing: ${signing.summary}`);
      await run("pnpm", [
        "--filter",
        "@kaioken/desktop",
        "run",
        "prepare-runtime",
      ]);
      await run("pnpm", ["--filter", "@kaioken/desktop", "run", "build"]);
      await run(
        "node",
        [
          join(desktopRoot, "scripts", "run-electron-builder.mjs"),
          "--mac",
          "zip",
          "--arm64",
          "--publish",
          "never",
        ],
        { cwd: desktopRoot, env: signing.env },
      );
      await run("pnpm", [
        "--filter",
        "@kaioken/desktop",
        "run",
        "desktop:version-feed",
      ]);
    }
    assets = await collectAssets(version);
  } catch (error) {
    await restoreVersionFiles();
    throw error;
  }
  console.log(`Assets:\n  ${assets.join("\n  ")}`);

  if (options.dryRun) {
    console.log("Dry run: not committing, tagging, or publishing.");
    await restoreVersionFiles();
    return;
  }

  await run("git", [
    "add",
    "apps/desktop/package.json",
    "packages/kaioken-app/package.json",
  ]);
  await run("git", ["commit", "-q", "-m", `Release desktop ${version}`]);
  const sha = await capture("git", ["rev-parse", "HEAD"]);
  await run("git", ["tag", versionTag, sha]);
  await run("git", ["tag", "-f", LATEST_TAG, sha]);
  await run("git", ["push", "origin", "main", `refs/tags/${versionTag}`]);
  await run("git", ["push", "--force", "origin", `refs/tags/${LATEST_TAG}`]);

  await publishReleases({
    version,
    sha,
    assets,
    notes: options.notes ?? `Kaioken desktop ${version}`,
    singleUpload: options.singleUpload,
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
