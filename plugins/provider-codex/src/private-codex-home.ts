import fs from "node:fs";
import path from "node:path";

export const PRIVATE_CODEX_HOME_RELATIVE_PATH = path.join(
  ".kaioken",
  "codex-home",
);
export const KAIOKEN_CODEX_ORIGINATOR = "kaioken";

const SHARED_ENTRIES = [
  "auth.json",
  "config.toml",
  "AGENTS.md",
  "plugins",
  "skills",
  "memories",
  "computer-use",
  "installation_id",
  "cache",
  "vendor_imports",
  "mcp-oauth-locks",
  "chrome-native-hosts.json",
  "chrome-native-hosts-v2.json",
] as const;
const SHARED_ENTRY_PATTERNS = [/^memories_\d+\.sqlite(?:-wal|-shm)?$/];
const COPIED_ENTRIES = [
  ".sandbox_migration",
  ".personality_migration",
  "version.json",
] as const;
const ROLLOUT_DIRECTORIES = ["sessions", "archived_sessions"] as const;
const MIGRATION_MARKER = ".kaioken-rollouts-migrated-v1";
const ROLLOUT_HEADER_BYTES = 64 * 1024;

export interface PreparePrivateCodexHomeArgs {
  sharedHome: string;
  privateHome: string;
  originator?: string;
}

export interface PreparePrivateCodexHomeResult {
  linked: string[];
  migratedRollouts: number;
}

export function resolvePrivateCodexHome(homeDir: string): string {
  return path.join(homeDir, PRIVATE_CODEX_HOME_RELATIVE_PATH);
}

function isSharedEntry(name: string): boolean {
  return (
    (SHARED_ENTRIES as readonly string[]).includes(name) ||
    SHARED_ENTRY_PATTERNS.some((pattern) => pattern.test(name))
  );
}

function lstatOrNull(target: string): fs.Stats | null {
  try {
    return fs.lstatSync(target);
  } catch {
    return null;
  }
}

function linkSharedEntries(sharedHome: string, privateHome: string): string[] {
  const linked: string[] = [];
  for (const name of fs.readdirSync(sharedHome)) {
    if (!isSharedEntry(name)) {
      continue;
    }
    const target = path.join(privateHome, name);
    if (lstatOrNull(target) !== null) {
      continue;
    }
    fs.symlinkSync(path.join(sharedHome, name), target);
    linked.push(name);
  }
  return linked;
}

function copyMarkerEntries(sharedHome: string, privateHome: string): void {
  for (const name of COPIED_ENTRIES) {
    const source = path.join(sharedHome, name);
    const target = path.join(privateHome, name);
    if (
      lstatOrNull(target) !== null ||
      lstatOrNull(source)?.isFile() !== true
    ) {
      continue;
    }
    fs.copyFileSync(source, target);
  }
}

function readRolloutHeader(filePath: string): string {
  const descriptor = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(ROLLOUT_HEADER_BYTES);
    const bytesRead = fs.readSync(descriptor, buffer, 0, buffer.length, 0);
    const header = buffer.toString("utf8", 0, bytesRead);
    const newline = header.indexOf("\n");
    return newline === -1 ? header : header.slice(0, newline);
  } finally {
    fs.closeSync(descriptor);
  }
}

function listRollouts(directory: string): string[] {
  const rollouts: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop();
    if (current === undefined) {
      break;
    }
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isDirectory()) {
        pending.push(entryPath);
      } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
        rollouts.push(entryPath);
      }
    }
  }
  return rollouts;
}

function moveFile(source: string, target: string): void {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  try {
    fs.renameSync(source, target);
  } catch {
    fs.copyFileSync(source, target);
    fs.unlinkSync(source);
  }
}

export function isRolloutFromOriginator(
  filePath: string,
  originator: string,
): boolean {
  try {
    const header = readRolloutHeader(filePath);
    return header.includes(`"originator":${JSON.stringify(originator)}`);
  } catch {
    return false;
  }
}

function migrateRollouts(
  sharedHome: string,
  privateHome: string,
  originator: string,
): number {
  const marker = path.join(privateHome, MIGRATION_MARKER);
  if (lstatOrNull(marker) !== null) {
    return 0;
  }
  let migrated = 0;
  for (const directory of ROLLOUT_DIRECTORIES) {
    const sharedDirectory = path.join(sharedHome, directory);
    for (const rollout of listRollouts(sharedDirectory)) {
      if (!isRolloutFromOriginator(rollout, originator)) {
        continue;
      }
      moveFile(
        rollout,
        path.join(
          privateHome,
          directory,
          path.relative(sharedDirectory, rollout),
        ),
      );
      migrated += 1;
    }
  }
  fs.writeFileSync(marker, `${new Date().toISOString()}\n`);
  return migrated;
}

export function preparePrivateCodexHome(
  args: PreparePrivateCodexHomeArgs,
): PreparePrivateCodexHomeResult {
  const sharedHome = path.resolve(args.sharedHome);
  const privateHome = path.resolve(args.privateHome);
  if (sharedHome === privateHome) {
    return { linked: [], migratedRollouts: 0 };
  }
  fs.mkdirSync(privateHome, { recursive: true });
  for (const directory of ROLLOUT_DIRECTORIES) {
    fs.mkdirSync(path.join(privateHome, directory), { recursive: true });
  }
  if (lstatOrNull(sharedHome)?.isDirectory() !== true) {
    return { linked: [], migratedRollouts: 0 };
  }
  const linked = linkSharedEntries(sharedHome, privateHome);
  copyMarkerEntries(sharedHome, privateHome);
  const migratedRollouts = migrateRollouts(
    sharedHome,
    privateHome,
    args.originator ?? KAIOKEN_CODEX_ORIGINATOR,
  );
  return { linked, migratedRollouts };
}
