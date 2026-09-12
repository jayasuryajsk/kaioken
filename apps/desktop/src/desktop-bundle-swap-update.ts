import { execFile, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import type { Dirent } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import type { KaiokenDesktopVersionFeed } from "@kaioken/desktop-contract";
import type {
  DesktopAutoUpdateAvailableHandler,
  DesktopAutoUpdateCheckOutcome,
  DesktopAutoUpdateDownloadedHandler,
  DesktopAutoUpdateErrorHandler,
  DesktopAutoUpdateLogger,
  DesktopAutoUpdateNotAvailableHandler,
  DesktopAutoUpdaterAdapter,
} from "./desktop-auto-update.js";
import {
  DESKTOP_UPDATE_CHECK_TIMEOUT_MS,
  parseDesktopVersionFeed,
} from "./desktop-update-check.js";
import {
  assembleDelta,
  fileSize,
  parseBlockMap,
  planDelta,
  sha512Base64,
  type BlockMap,
} from "./desktop-delta-download.js";

const execFileAsync = promisify(execFile);

export const BUNDLE_SWAP_LOG_FILE_NAME = "bundle-swap.log";
const RELAUNCH_SCRIPT_FILE_NAME = "relaunch.sh";
const DOWNLOAD_TIMEOUT_MS = 20 * 60 * 1000;

interface StagedUpdate {
  version: string;
  archivePath: string;
}

export interface CreateBundleSwapUpdaterArgs {
  bundlePath: string;
  channel: KaiokenDesktopVersionFeed["channel"];
  currentVersion: string;
  downloadDir: string;
  exit: () => void;
  feedUrl: string;
  fetchImpl?: typeof fetch;
  logger: DesktopAutoUpdateLogger;
  processId: number;
  releaseBaseUrl: string;
  spawnDetached?: (scriptPath: string) => void;
}

export interface BundleSwapUpdater extends DesktopAutoUpdaterAdapter {
  getStagedUpdate(): StagedUpdate | null;
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function createRelaunchScript(args: {
  processId: number;
  bundlePath: string;
  stagedBundlePath: string;
  logPath: string;
}): string {
  const bundle = shellQuote(args.bundlePath);
  const staged = shellQuote(args.stagedBundlePath);
  const backup = shellQuote(`${args.bundlePath}.previous`);
  const log = shellQuote(args.logPath);
  return [
    "#!/bin/sh",
    `exec >> ${log} 2>&1`,
    `echo "[$(date -u +%FT%TZ)] waiting for pid ${args.processId} to exit"`,
    `while kill -0 ${args.processId} 2>/dev/null; do sleep 0.2; done`,
    `rm -rf ${backup}`,
    `if ! mv ${bundle} ${backup}; then echo "failed to move the current bundle aside"; open -n ${bundle}; exit 1; fi`,
    `if ! mv ${staged} ${bundle}; then echo "failed to move the new bundle into place; restoring"; mv ${backup} ${bundle}; open -n ${bundle}; exit 1; fi`,
    `xattr -dr com.apple.quarantine ${bundle} 2>/dev/null || true`,
    `echo "[$(date -u +%FT%TZ)] swapped in new bundle"`,
    `open -n ${bundle}`,
    `sleep 5`,
    `rm -rf ${backup}`,
    "",
  ].join("\n");
}

function pickArchive(
  feed: KaiokenDesktopVersionFeed,
): KaiokenDesktopVersionFeed["files"][number] | null {
  return (
    feed.files.find((file) => file.url.toLowerCase().endsWith(".zip")) ?? null
  );
}

async function fileMatches(
  path: string,
  expected: { sha512: string; size: number },
): Promise<boolean> {
  try {
    const stats = await stat(path);
    if (stats.size !== expected.size) return false;
    const hash = createHash("sha512");
    hash.update(await readFile(path));
    return hash.digest("base64") === expected.sha512;
  } catch {
    return false;
  }
}

async function findAppBundle(directory: string): Promise<string | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  const bundle = entries.find(
    (entry) => entry.isDirectory() && entry.name.endsWith(".app"),
  );
  return bundle === undefined ? null : join(directory, bundle.name);
}

function defaultSpawnDetached(scriptPath: string): void {
  const child = spawn("/bin/sh", [scriptPath], {
    detached: true,
    stdio: "ignore",
  });
  child.unref();
}

export function createBundleSwapUpdater(
  args: CreateBundleSwapUpdaterArgs,
): BundleSwapUpdater {
  const fetchImpl = args.fetchImpl ?? fetch;
  const spawnDetached = args.spawnDetached ?? defaultSpawnDetached;
  const errorHandlers = new Set<DesktopAutoUpdateErrorHandler>();
  const availableHandlers = new Set<DesktopAutoUpdateAvailableHandler>();
  const downloadedHandlers = new Set<DesktopAutoUpdateDownloadedHandler>();
  const notAvailableHandlers = new Set<DesktopAutoUpdateNotAvailableHandler>();
  let latestFeed: KaiokenDesktopVersionFeed | null = null;
  let staged: StagedUpdate | null = null;
  let installing = false;

  function emitError(error: Error, message: string | null): void {
    for (const handler of errorHandlers) handler({ error, message });
  }

  async function checkForUpdates(): Promise<DesktopAutoUpdateCheckOutcome | null> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      DESKTOP_UPDATE_CHECK_TIMEOUT_MS,
    );
    let payloadText: string;
    try {
      const response = await fetchImpl(args.feedUrl, {
        headers: { accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      payloadText = await response.text();
    } finally {
      clearTimeout(timeout);
    }
    const parsed = parseDesktopVersionFeed({
      channel: args.channel,
      checkedAt: new Date().toISOString(),
      currentVersion: args.currentVersion,
      payloadText,
      platform: "macos",
    });
    if (parsed.kind === "malformed") {
      throw new Error(parsed.reason);
    }
    latestFeed = parsed.feed;
    const outcome: DesktopAutoUpdateCheckOutcome = {
      isUpdateAvailable: parsed.info.updateAvailable,
      updateInfo: { version: parsed.feed.version },
    };
    if (outcome.isUpdateAvailable) {
      for (const handler of availableHandlers) handler(outcome.updateInfo);
    } else {
      for (const handler of notAvailableHandlers) handler(outcome.updateInfo);
    }
    return outcome;
  }

  function archiveUrl(fileUrl: string): string {
    return new URL(fileUrl, args.releaseBaseUrl).toString();
  }

  function versionedReleaseBase(version: string): string {
    return args.releaseBaseUrl.replace(
      /desktop-latest\/?$/u,
      `desktop-v${version}/`,
    );
  }

  async function fetchBytes(
    url: string,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const response = await fetchImpl(url, { signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return new Uint8Array(await response.arrayBuffer());
  }

  async function fetchRange(
    url: string,
    start: number,
    endInclusive: number,
    signal: AbortSignal,
  ): Promise<Uint8Array> {
    const response = await fetchImpl(url, {
      signal,
      headers: { range: `bytes=${start}-${endInclusive}` },
    });
    if (response.status !== 206) {
      throw new Error(`range request returned HTTP ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  async function findBaseArchive(
    excludeVersion: string,
  ): Promise<{ archivePath: string; blockMap: BlockMap } | null> {
    const entries: Dirent[] = await readdir(args.downloadDir, {
      withFileTypes: true,
    }).catch(() => []);
    const candidates = entries
      .filter((entry) => entry.isDirectory() && entry.name !== excludeVersion)
      .map((entry) => entry.name)
      .sort()
      .reverse();
    for (const version of candidates) {
      const dir = join(args.downloadDir, version);
      const files: string[] = await readdir(dir).catch(() => []);
      const zip = files.find((name) => name.endsWith(".zip"));
      if (zip === undefined) continue;
      const blockMapPath = join(dir, `${zip}.blockmap`);
      try {
        if (!files.includes(`${zip}.blockmap`)) {
          const controller = new AbortController();
          const timeout = setTimeout(
            () => controller.abort(),
            DESKTOP_UPDATE_CHECK_TIMEOUT_MS,
          );
          try {
            await writeFile(
              blockMapPath,
              await fetchBytes(
                `${versionedReleaseBase(version)}${zip}.blockmap`,
                controller.signal,
              ),
            );
          } finally {
            clearTimeout(timeout);
          }
        }
        const blockMap = parseBlockMap(await readFile(blockMapPath));
        return { archivePath: join(dir, zip), blockMap };
      } catch {}
    }
    return null;
  }

  async function streamDownload(
    url: string,
    destination: string,
    signal: AbortSignal,
  ): Promise<{ digest: string; received: number }> {
    const response = await fetchImpl(url, { signal });
    if (!response.ok || response.body === null) {
      throw new Error(`HTTP ${response.status}`);
    }
    const hash = createHash("sha512");
    let received = 0;
    const reader = response.body.getReader();
    const output = createWriteStream(destination);
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const buffer = Buffer.from(value);
        hash.update(buffer);
        received += buffer.length;
        if (!output.write(buffer)) {
          await new Promise<void>((resolveDrain) =>
            output.once("drain", resolveDrain),
          );
        }
      }
    } finally {
      await new Promise<void>((resolveEnd) => output.end(resolveEnd));
    }
    return { digest: hash.digest("base64"), received };
  }

  async function downloadUpdate(): Promise<Array<string>> {
    const feed = latestFeed;
    if (feed === null) {
      throw new Error("No update feed has been checked yet");
    }
    const archive = pickArchive(feed);
    if (archive === null) {
      throw new Error("The update feed lists no .zip archive for macOS");
    }
    const archiveName = archive.url.split("/").pop() ?? archive.url;
    const versionDir = join(args.downloadDir, feed.version);
    const archivePath = join(versionDir, archiveName);
    const blockMapPath = `${archivePath}.blockmap`;
    await mkdir(versionDir, { recursive: true });
    if (!(await fileMatches(archivePath, archive))) {
      const partialPath = `${archivePath}.part`;
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), DOWNLOAD_TIMEOUT_MS);
      const url = archiveUrl(archive.url);
      try {
        let done = false;
        try {
          const blockMapBytes = await fetchBytes(
            `${url}.blockmap`,
            controller.signal,
          );
          const newMap = parseBlockMap(blockMapBytes);
          const base = await findBaseArchive(feed.version);
          const plan = planDelta(
            base?.blockMap ?? { version: "", files: [] },
            newMap,
          );
          if (base !== null) {
            args.logger.info(
              `Desktop update ${feed.version}: reusing ${Math.round(plan.copyBytes / 1e6)} MB from the previous archive, fetching ${Math.round(plan.fetchBytes / 1e6)} MB`,
            );
          }
          if (base === null) await writeFile(partialPath, "");
          await assembleDelta({
            plan,
            basePath: base?.archivePath ?? partialPath,
            outputPath: partialPath,
            totalSize: archive.size,
            source: {
              fetchRange: (start, endInclusive) =>
                fetchRange(url, start, endInclusive, controller.signal),
            },
          });
          const digest = await sha512Base64(partialPath);
          const size = await fileSize(partialPath);
          if (digest === archive.sha512 && size === archive.size) {
            await writeFile(blockMapPath, blockMapBytes);
            done = true;
          } else {
            args.logger.warn(
              `Desktop update ${feed.version}: delta assembly did not match the feed; falling back to a full download`,
            );
          }
        } catch (error) {
          args.logger.warn(
            `Desktop update ${feed.version}: delta download unavailable (${error instanceof Error ? error.message : String(error)}); falling back to a full download`,
          );
        }
        if (!done) {
          await rm(partialPath, { force: true });
          const { digest, received } = await streamDownload(
            url,
            partialPath,
            controller.signal,
          );
          if (digest !== archive.sha512 || received !== archive.size) {
            await rm(partialPath, { force: true });
            throw new Error(
              `Downloaded archive did not match the feed (size ${received}/${archive.size}, sha512 ${digest === archive.sha512 ? "ok" : "mismatch"})`,
            );
          }
          try {
            await writeFile(
              blockMapPath,
              await fetchBytes(`${url}.blockmap`, controller.signal),
            );
          } catch {}
        }
        await rm(archivePath, { force: true });
        await execFileAsync("/bin/mv", [partialPath, archivePath]);
      } finally {
        clearTimeout(timeout);
      }
    }
    const keep = new Set<string>([feed.version]);
    const previous = await findBaseArchive(feed.version);
    if (previous !== null)
      keep.add(dirname(previous.archivePath).split("/").pop() ?? "");
    for (const entry of await readdir(args.downloadDir).catch(() => [])) {
      if (!keep.has(entry) && !entry.includes(".")) {
        await rm(join(args.downloadDir, entry), {
          recursive: true,
          force: true,
        });
      }
    }
    staged = { version: feed.version, archivePath };
    for (const handler of downloadedHandlers)
      handler({ version: feed.version });
    return [archivePath];
  }

  async function install(): Promise<void> {
    if (staged === null) {
      throw new Error("No downloaded update to install");
    }
    const stagingDir = join(dirname(staged.archivePath), "extracted");
    await rm(stagingDir, { recursive: true, force: true });
    await mkdir(stagingDir, { recursive: true });
    await execFileAsync("/usr/bin/ditto", [
      "-x",
      "-k",
      staged.archivePath,
      stagingDir,
    ]);
    const stagedBundlePath = await findAppBundle(stagingDir);
    if (stagedBundlePath === null) {
      throw new Error("The downloaded archive did not contain an .app bundle");
    }
    const logPath = join(args.downloadDir, BUNDLE_SWAP_LOG_FILE_NAME);
    const scriptPath = join(args.downloadDir, RELAUNCH_SCRIPT_FILE_NAME);
    await writeFile(
      scriptPath,
      createRelaunchScript({
        processId: args.processId,
        bundlePath: resolve(args.bundlePath),
        stagedBundlePath,
        logPath,
      }),
      { mode: 0o755 },
    );
    args.logger.info(
      `Desktop update ${staged.version} staged at ${stagedBundlePath}; swapping ${args.bundlePath} on exit.`,
    );
    spawnDetached(scriptPath);
    args.exit();
  }

  return {
    checkForUpdates,
    downloadUpdate,
    getStagedUpdate() {
      return staged;
    },
    onError(handler) {
      errorHandlers.add(handler);
    },
    onUpdateAvailable(handler) {
      availableHandlers.add(handler);
    },
    onUpdateDownloaded(handler) {
      downloadedHandlers.add(handler);
    },
    onUpdateNotAvailable(handler) {
      notAvailableHandlers.add(handler);
    },
    quitAndInstall() {
      if (installing) return;
      installing = true;
      void install().catch((error: unknown) => {
        installing = false;
        const message = error instanceof Error ? error.message : String(error);
        args.logger.error(`Desktop update install failed: ${message}`);
        emitError(error instanceof Error ? error : new Error(message), null);
      });
    },
    setAutoDownload() {},
    setAutoInstallOnAppQuit() {},
    setFeedURL() {},
    setForceDevUpdateConfig() {},
    setLogger() {},
  };
}
