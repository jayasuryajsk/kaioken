import { createHash } from "node:crypto";
import { open, readFile, stat } from "node:fs/promises";
import { gunzipSync } from "node:zlib";

export interface BlockMapFile {
  name: string;
  offset: number;
  checksums: string[];
  sizes: number[];
}

export interface BlockMap {
  version: string;
  files: BlockMapFile[];
}

export interface Block {
  offset: number;
  size: number;
  checksum: string;
}

export type DeltaStep =
  | { kind: "copy"; from: number; to: number; size: number }
  | { kind: "fetch"; from: number; to: number; size: number };

export interface DeltaPlan {
  steps: DeltaStep[];
  copyBytes: number;
  fetchBytes: number;
}

export interface RangeSource {
  fetchRange(start: number, endInclusive: number): Promise<Uint8Array>;
}

const MAX_RANGE_BYTES = 8 * 1024 * 1024;
const PARALLEL_RANGES = 4;

export function parseBlockMap(bytes: Uint8Array): BlockMap {
  const text = gunzipSync(bytes).toString("utf8");
  const parsed: unknown = JSON.parse(text);
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    !("files" in parsed) ||
    !Array.isArray(parsed.files)
  ) {
    throw new Error("block map has no files");
  }
  const files: BlockMapFile[] = [];
  for (const raw of parsed.files) {
    if (
      typeof raw !== "object" ||
      raw === null ||
      typeof (raw as BlockMapFile).offset !== "number" ||
      !Array.isArray((raw as BlockMapFile).checksums) ||
      !Array.isArray((raw as BlockMapFile).sizes)
    ) {
      throw new Error("block map file entry is malformed");
    }
    const entry = raw as BlockMapFile;
    if (entry.checksums.length !== entry.sizes.length) {
      throw new Error("block map checksums and sizes differ in length");
    }
    files.push({
      name: typeof entry.name === "string" ? entry.name : "",
      offset: entry.offset,
      checksums: entry.checksums,
      sizes: entry.sizes,
    });
  }
  return {
    version:
      typeof (parsed as BlockMap).version === "string"
        ? (parsed as BlockMap).version
        : "",
    files,
  };
}

export function blocksOf(map: BlockMap): Block[] {
  const blocks: Block[] = [];
  for (const file of map.files) {
    let offset = file.offset;
    for (const [index, size] of file.sizes.entries()) {
      blocks.push({ offset, size, checksum: file.checksums[index] ?? "" });
      offset += size;
    }
  }
  return blocks;
}

export function planDelta(oldMap: BlockMap, newMap: BlockMap): DeltaPlan {
  const oldByChecksum = new Map<string, Block>();
  for (const block of blocksOf(oldMap)) {
    if (!oldByChecksum.has(block.checksum)) {
      oldByChecksum.set(block.checksum, block);
    }
  }
  const steps: DeltaStep[] = [];
  let copyBytes = 0;
  let fetchBytes = 0;
  for (const block of blocksOf(newMap)) {
    const reuse = oldByChecksum.get(block.checksum);
    const last = steps[steps.length - 1];
    if (reuse !== undefined && reuse.size === block.size) {
      copyBytes += block.size;
      if (
        last?.kind === "copy" &&
        last.from + last.size === reuse.offset &&
        last.to + last.size === block.offset
      ) {
        last.size += block.size;
      } else {
        steps.push({
          kind: "copy",
          from: reuse.offset,
          to: block.offset,
          size: block.size,
        });
      }
      continue;
    }
    fetchBytes += block.size;
    if (
      last?.kind === "fetch" &&
      last.from + last.size === block.offset &&
      last.size + block.size <= MAX_RANGE_BYTES
    ) {
      last.size += block.size;
    } else {
      steps.push({
        kind: "fetch",
        from: block.offset,
        to: block.offset,
        size: block.size,
      });
    }
  }
  return { steps, copyBytes, fetchBytes };
}

async function mapWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T) => Promise<void>,
): Promise<void> {
  let next = 0;
  const runners = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (next < items.length) {
        const item = items[next]!;
        next += 1;
        await worker(item);
      }
    },
  );
  await Promise.all(runners);
}

export async function assembleDelta(args: {
  plan: DeltaPlan;
  basePath: string;
  outputPath: string;
  totalSize: number;
  source: RangeSource;
  onProgress?: (fetchedBytes: number) => void;
}): Promise<void> {
  const base = await open(args.basePath, "r");
  const output = await open(args.outputPath, "w");
  try {
    await output.truncate(args.totalSize);
    for (const step of args.plan.steps) {
      if (step.kind !== "copy") continue;
      let remaining = step.size;
      let from = step.from;
      let to = step.to;
      const chunk = Buffer.alloc(Math.min(remaining, 4 * 1024 * 1024));
      while (remaining > 0) {
        const length = Math.min(remaining, chunk.length);
        const { bytesRead } = await base.read(chunk, 0, length, from);
        if (bytesRead !== length) {
          throw new Error("base archive is shorter than its block map");
        }
        await output.write(chunk, 0, length, to);
        remaining -= length;
        from += length;
        to += length;
      }
    }
    let fetched = 0;
    const fetchSteps = args.plan.steps.filter(
      (step): step is Extract<DeltaStep, { kind: "fetch" }> =>
        step.kind === "fetch",
    );
    await mapWithConcurrency(fetchSteps, PARALLEL_RANGES, async (step) => {
      const bytes = await args.source.fetchRange(
        step.from,
        step.from + step.size - 1,
      );
      if (bytes.byteLength !== step.size) {
        throw new Error(
          `range ${step.from}-${step.from + step.size - 1} returned ${bytes.byteLength} bytes`,
        );
      }
      await output.write(bytes, 0, bytes.byteLength, step.to);
      fetched += step.size;
      args.onProgress?.(fetched);
    });
  } finally {
    await base.close();
    await output.close();
  }
}

export async function sha512Base64(path: string): Promise<string> {
  const hash = createHash("sha512");
  hash.update(await readFile(path));
  return hash.digest("base64");
}

export async function fileSize(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}
