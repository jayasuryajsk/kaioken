import { createHash, randomBytes } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { afterEach, describe, expect, it } from "vitest";
import {
  assembleDelta,
  parseBlockMap,
  planDelta,
  type BlockMap,
} from "../src/desktop-delta-download.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

function mapFor(chunks: Buffer[]): BlockMap {
  return {
    version: "2",
    files: [
      {
        name: "file",
        offset: 0,
        checksums: chunks.map((chunk) =>
          createHash("sha256").update(chunk).digest("base64"),
        ),
        sizes: chunks.map((chunk) => chunk.length),
      },
    ],
  };
}

describe("parseBlockMap", () => {
  it("reads the gzipped JSON block map electron-builder writes", () => {
    const encoded = gzipSync(
      JSON.stringify({
        version: "2",
        files: [{ name: "a", offset: 0, checksums: ["x", "y"], sizes: [3, 4] }],
      }),
    );
    expect(parseBlockMap(encoded)).toEqual({
      version: "2",
      files: [{ name: "a", offset: 0, checksums: ["x", "y"], sizes: [3, 4] }],
    });
    expect(() =>
      parseBlockMap(gzipSync(JSON.stringify({ files: "nope" }))),
    ).toThrow(/no files/);
  });
});

describe("planDelta and assembleDelta", () => {
  it("copies unchanged blocks from the old archive and fetches only the rest", async () => {
    const root = await mkdtemp(join(tmpdir(), "kaioken-delta-"));
    roots.push(root);
    const a = randomBytes(1000);
    const b = randomBytes(1000);
    const c = randomBytes(1000);
    const d = randomBytes(500);
    const oldChunks = [a, b, c];
    const newChunks = [a, d, c, b];
    const oldArchive = Buffer.concat(oldChunks);
    const newArchive = Buffer.concat(newChunks);
    const basePath = join(root, "old.zip");
    const outputPath = join(root, "new.zip");
    await writeFile(basePath, oldArchive);

    const plan = planDelta(mapFor(oldChunks), mapFor(newChunks));
    expect(plan.copyBytes).toBe(3000);
    expect(plan.fetchBytes).toBe(500);
    expect(plan.steps.map((step) => step.kind)).toEqual([
      "copy",
      "fetch",
      "copy",
      "copy",
    ]);

    const ranges: string[] = [];
    await assembleDelta({
      plan,
      basePath,
      outputPath,
      totalSize: newArchive.length,
      source: {
        fetchRange: async (start, endInclusive) => {
          ranges.push(`${start}-${endInclusive}`);
          return new Uint8Array(newArchive.subarray(start, endInclusive + 1));
        },
      },
    });
    expect(ranges).toEqual(["1000-1499"]);
    expect((await readFile(outputPath)).equals(newArchive)).toBe(true);
  });

  it("merges adjacent fetches into one range and fetches everything without a base", async () => {
    const root = await mkdtemp(join(tmpdir(), "kaioken-delta-"));
    roots.push(root);
    const chunks = [randomBytes(300), randomBytes(300), randomBytes(300)];
    const archive = Buffer.concat(chunks);
    const outputPath = join(root, "new.zip");
    const emptyBase = join(root, "empty");
    await writeFile(emptyBase, "");
    const plan = planDelta({ version: "2", files: [] }, mapFor(chunks));
    expect(plan.copyBytes).toBe(0);
    expect(plan.steps).toEqual([{ kind: "fetch", from: 0, to: 0, size: 900 }]);
    await assembleDelta({
      plan,
      basePath: emptyBase,
      outputPath,
      totalSize: archive.length,
      source: {
        fetchRange: async (start, endInclusive) =>
          new Uint8Array(archive.subarray(start, endInclusive + 1)),
      },
    });
    expect((await readFile(outputPath)).equals(archive)).toBe(true);
  });

  it("rejects a range response of the wrong length", async () => {
    const root = await mkdtemp(join(tmpdir(), "kaioken-delta-"));
    roots.push(root);
    const chunks = [randomBytes(100)];
    const emptyBase = join(root, "empty");
    await writeFile(emptyBase, "");
    await expect(
      assembleDelta({
        plan: planDelta({ version: "2", files: [] }, mapFor(chunks)),
        basePath: emptyBase,
        outputPath: join(root, "new.zip"),
        totalSize: 100,
        source: { fetchRange: async () => new Uint8Array(10) },
      }),
    ).rejects.toThrow(/returned 10 bytes/);
  });
});
