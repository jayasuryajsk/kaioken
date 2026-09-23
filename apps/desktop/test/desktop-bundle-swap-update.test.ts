import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  createBundleSwapUpdater,
  createRelaunchScript,
  type CreateBundleSwapUpdaterArgs,
} from "../src/desktop-bundle-swap-update.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function makeRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "kaioken-bundle-swap-"));
  roots.push(root);
  return root;
}

function feedFor(
  version: string,
  archive: Buffer,
  name = `Kaioken-${version}-arm64.zip`,
) {
  const sha512 = createHash("sha512").update(archive).digest("base64");
  return {
    schemaVersion: 1,
    channel: "latest",
    platform: "macos",
    version,
    releaseDate: "2026-09-12T00:00:00.000Z",
    releaseName: `Kaioken desktop ${version}`,
    releaseNotes: null,
    minimumSystemVersion: null,
    files: [{ url: name, sha512, size: archive.length }],
    path: name,
    sha512,
    stagingPercentage: null,
  };
}

function createUpdater(
  root: string,
  responses: Record<string, () => Response>,
  overrides: Partial<CreateBundleSwapUpdaterArgs> = {},
) {
  const logs: string[] = [];
  const exits: number[] = [];
  const spawned: string[] = [];
  const updater = createBundleSwapUpdater({
    bundlePath: join(root, "Applications", "Kaioken.app"),
    channel: "latest",
    currentVersion: "0.42.1",
    downloadDir: join(root, "updates"),
    exit: () => exits.push(1),
    feedUrl: "https://example.test/desktop-version.json",
    fetchImpl: (input) => {
      const url = typeof input === "string" ? input : input.toString();
      const respond = responses[url];
      return Promise.resolve(
        respond === undefined ? new Response(null, { status: 404 }) : respond(),
      );
    },
    logger: {
      error: (message) => logs.push(`error: ${message}`),
      info: (message) => logs.push(`info: ${message}`),
      warn: (message) => logs.push(`warn: ${message}`),
    },
    processId: 4242,
    releaseBaseUrl: "https://example.test/releases/",
    spawnDetached: (scriptPath) => spawned.push(scriptPath),
    ...overrides,
  });
  return { updater, logs, exits, spawned };
}

describe("createBundleSwapUpdater", () => {
  it("reports a newer feed version and downloads the verified archive", async () => {
    const root = await makeRoot();
    const archive = Buffer.from("zip-bytes-for-0.43.0");
    const feed = feedFor("0.43.0", archive);
    const { updater } = createUpdater(root, {
      "https://example.test/desktop-version.json": () =>
        new Response(JSON.stringify(feed)),
      "https://example.test/releases/Kaioken-0.43.0-arm64.zip": () =>
        new Response(archive),
    });
    const available: string[] = [];
    const downloaded: string[] = [];
    updater.onUpdateAvailable((info) => available.push(info.version));
    updater.onUpdateDownloaded((info) => downloaded.push(info.version));

    const outcome = await updater.checkForUpdates();
    expect(outcome).toEqual({
      isUpdateAvailable: true,
      updateInfo: { version: "0.43.0" },
    });
    expect(available).toEqual(["0.43.0"]);

    const [archivePath] = await updater.downloadUpdate();
    expect(archivePath).toBe(
      join(root, "updates", "0.43.0", "Kaioken-0.43.0-arm64.zip"),
    );
    expect(await readFile(archivePath!)).toEqual(archive);
    expect(downloaded).toEqual(["0.43.0"]);
    expect(updater.getStagedUpdate()).toEqual({
      version: "0.43.0",
      archivePath,
    });
  });

  it("refuses an archive whose hash does not match the feed", async () => {
    const root = await makeRoot();
    const feed = feedFor("0.43.0", Buffer.from("expected"));
    const { updater } = createUpdater(root, {
      "https://example.test/desktop-version.json": () =>
        new Response(JSON.stringify(feed)),
      "https://example.test/releases/Kaioken-0.43.0-arm64.zip": () =>
        new Response(Buffer.from("tampered")),
    });
    await updater.checkForUpdates();
    await expect(updater.downloadUpdate()).rejects.toThrow(/did not match/);
    expect(updater.getStagedUpdate()).toBeNull();
  });

  it("does not report an update for the current or an older version", async () => {
    const root = await makeRoot();
    const feed = feedFor("0.42.1", Buffer.from("same"));
    const { updater } = createUpdater(root, {
      "https://example.test/desktop-version.json": () =>
        new Response(JSON.stringify(feed)),
    });
    const notAvailable: string[] = [];
    updater.onUpdateNotAvailable((info) => notAvailable.push(info.version));
    const outcome = await updater.checkForUpdates();
    expect(outcome?.isUpdateAvailable).toBe(false);
    expect(notAvailable).toEqual(["0.42.1"]);
  });

  it("surfaces an install error instead of exiting when nothing is staged", async () => {
    const root = await makeRoot();
    const { updater, exits, logs } = createUpdater(root, {});
    const errors: string[] = [];
    updater.onError((args) => errors.push(args.error.message));
    updater.quitAndInstall();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(exits).toEqual([]);
    expect(errors).toEqual(["No downloaded update to install"]);
    expect(logs.some((line) => line.startsWith("error:"))).toBe(true);
  });

  it("writes a relaunch script that swaps the bundle after the process exits", () => {
    const script = createRelaunchScript({
      processId: 99,
      bundlePath: "/Applications/Kaioken.app",
      stagedBundlePath: "/tmp/updates/0.43.0/extracted/Kaioken.app",
      logPath: "/tmp/updates/bundle-swap.log",
    });
    expect(script).toContain(
      "while kill -0 99 2>/dev/null; do sleep 0.2; done",
    );
    expect(script).toContain(
      "mv '/Applications/Kaioken.app' '/Applications/Kaioken.app.previous'",
    );
    expect(script).toContain(
      "mv '/tmp/updates/0.43.0/extracted/Kaioken.app' '/Applications/Kaioken.app'",
    );
    expect(script).toContain("open -n '/Applications/Kaioken.app'");
    expect(script).toContain("xattr -dr com.apple.quarantine");
    expect(script).toContain("lsregister -f '/Applications/Kaioken.app'");
    expect(script.indexOf("lsregister")).toBeLessThan(
      script.lastIndexOf("open -n"),
    );
    expect(script.indexOf("kill -0 99")).toBeLessThan(
      script.indexOf("mv '/Applications"),
    );
  });

  it("installs a staged archive by extracting it and handing off to the relaunch script", async () => {
    const root = await makeRoot();
    const bundleDir = join(root, "src", "Kaioken.app", "Contents");
    await rm(bundleDir, { recursive: true, force: true });
    const { mkdir } = await import("node:fs/promises");
    await mkdir(bundleDir, { recursive: true });
    await writeFile(join(bundleDir, "Info.plist"), "<plist/>");
    const { execFile } = await import("node:child_process");
    const { promisify } = await import("node:util");
    const zipPath = join(root, "Kaioken-0.43.0-arm64.zip");
    await promisify(execFile)("/usr/bin/ditto", [
      "-c",
      "-k",
      "--keepParent",
      join(root, "src", "Kaioken.app"),
      zipPath,
    ]);
    const archive = await readFile(zipPath);
    const feed = feedFor("0.43.0", archive);
    const { updater, exits, spawned } = createUpdater(root, {
      "https://example.test/desktop-version.json": () =>
        new Response(JSON.stringify(feed)),
      "https://example.test/releases/Kaioken-0.43.0-arm64.zip": () =>
        new Response(archive),
    });
    await updater.checkForUpdates();
    await updater.downloadUpdate();
    updater.quitAndInstall();
    for (let attempt = 0; attempt < 100 && exits.length === 0; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    expect(exits).toEqual([1]);
    expect(spawned).toHaveLength(1);
    const script = await readFile(spawned[0]!, "utf8");
    expect(script).toContain(
      join(root, "updates", "0.43.0", "extracted", "Kaioken.app"),
    );
    expect(
      await readFile(
        join(
          root,
          "updates",
          "0.43.0",
          "extracted",
          "Kaioken.app",
          "Contents",
          "Info.plist",
        ),
        "utf8",
      ),
    ).toBe("<plist/>");
  });
});
