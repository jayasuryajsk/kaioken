import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  type Dirent,
} from "node:fs";
import path from "node:path";
import { readRolloutHeader, readRolloutLastOrdinal } from "./summary.js";

export const ROLLOUT_DIRECTORIES = ["sessions", "archived_sessions"] as const;
export type RolloutDirectory = (typeof ROLLOUT_DIRECTORIES)[number];

export const PRIVATE_CODEX_HOME_RELATIVE_PATH = path.join(
  ".kaioken",
  "codex-home",
);

export interface CodexHomes {
  shared: string;
  private: string;
}

export interface RolloutFile {
  path: string;
  archived: boolean;
}

export function isExistingDirectory(candidate: string): boolean {
  try {
    return existsSync(candidate) && statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

export function resolveCodexHomes(args: {
  env: Record<string, string | undefined>;
  homeDir: string;
}): CodexHomes {
  const shared = path.resolve(
    args.env.CODEX_HOME?.trim() || path.join(args.homeDir, ".codex"),
  );
  const privateHome = path.join(args.homeDir, PRIVATE_CODEX_HOME_RELATIVE_PATH);
  const privateExists =
    existsSync(privateHome) && statSync(privateHome).isDirectory();
  return { shared, private: privateExists ? privateHome : shared };
}

function walk(directory: string, sink: string[]): void {
  let entries: Dirent[];
  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(entryPath, sink);
    } else if (entry.isFile() && entry.name.endsWith(".jsonl")) {
      sink.push(entryPath);
    }
  }
}

export function listRolloutFiles(
  home: string,
  options: { includeArchived: boolean },
): RolloutFile[] {
  const files: RolloutFile[] = [];
  for (const directory of ROLLOUT_DIRECTORIES) {
    if (directory === "archived_sessions" && !options.includeArchived) continue;
    const sink: string[] = [];
    walk(path.join(home, directory), sink);
    for (const filePath of sink) {
      files.push({
        path: filePath,
        archived: directory === "archived_sessions",
      });
    }
  }
  return files;
}

export function rolloutRelativePath(home: string, filePath: string): string {
  const relative = path.relative(home, filePath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`rollout ${filePath} is outside ${home}`);
  }
  return relative;
}

export function findRolloutsById(home: string, id: string): RolloutFile[] {
  const matches: { file: RolloutFile; createdAt: string | null }[] = [];
  for (const file of listRolloutFiles(home, { includeArchived: true })) {
    const header = readRolloutHeader(file.path);
    if (header?.id === id) matches.push({ file, createdAt: header.createdAt });
  }
  return matches
    .sort((a, b) => {
      const byCreated = (a.createdAt ?? "").localeCompare(b.createdAt ?? "");
      return byCreated !== 0
        ? byCreated
        : a.file.path.localeCompare(b.file.path);
    })
    .map((match) => match.file);
}

export function findRolloutById(home: string, id: string): RolloutFile | null {
  return findRolloutsById(home, id).at(-1) ?? null;
}

export function copyRolloutBetweenHomes(args: {
  sourceHome: string;
  sourcePath: string;
  targetHome: string;
}): string {
  const relative = rolloutRelativePath(args.sourceHome, args.sourcePath);
  const targetPath = path.join(args.targetHome, relative);
  if (path.resolve(targetPath) === path.resolve(args.sourcePath)) {
    return targetPath;
  }
  mkdirSync(path.dirname(targetPath), { recursive: true });
  copyFileSync(args.sourcePath, targetPath);
  return targetPath;
}

export type CodexHomeKey = keyof CodexHomes;

export interface RolloutFiles {
  home: string;
  homeKey: CodexHomeKey;
  paths: string[];
}

export function findRolloutsInHomes(
  homes: CodexHomes,
  id: string,
  order: readonly CodexHomeKey[],
): RolloutFiles | null {
  const visited = new Set<string>();
  for (const key of order) {
    const home = homes[key];
    if (visited.has(home)) continue;
    visited.add(home);
    const files = findRolloutsById(home, id);
    if (files.length > 0) {
      return { home, homeKey: key, paths: files.map((file) => file.path) };
    }
  }
  return null;
}

export function copyRolloutsToHome(
  files: RolloutFiles,
  targetHome: string,
): string[] {
  return files.paths.map((sourcePath) =>
    copyRolloutBetweenHomes({
      sourceHome: files.home,
      sourcePath,
      targetHome,
    }),
  );
}

export function lastRolloutOrdinal(paths: readonly string[]): number {
  return paths.length === 0
    ? -1
    : Math.max(...paths.map((path) => readRolloutLastOrdinal(path)));
}
