import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, readdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, expect, it } from "vitest";
import {
  installTransferredCodexSession,
  prepareCodexSessionTransfer,
} from "../src/transfer.js";

const directories: string[] = [];
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
const sourceProviderThreadId = randomUUID();
const targetProviderThreadId = randomUUID();
const header = (ordinal: number) => ({
  type: "session_meta",
  ordinal,
  payload: {
    id: sourceProviderThreadId,
    session_id: sourceProviderThreadId,
    timestamp: "2026-09-15T00:00:00Z",
    cwd: "/source",
    opaque: { preserved: true },
  },
});
const message = (ordinal: number, text: string) => ({
  type: "response_item",
  ordinal,
  payload: {
    type: "message",
    role: "user",
    content: [{ type: "input_text", text }],
  },
});
const jsonl = (...lines: object[]) =>
  lines.map((line) => JSON.stringify(line)).join("\n");
const prepare = (contents: string[]) =>
  prepareCodexSessionTransfer({
    contents,
    sourceProviderThreadId,
    targetProviderThreadId,
    workspacePath: "/destination/project",
  });

it("merges sequenced segments without losing opaque native context or repeated user messages", () => {
  const contents = prepare([
    jsonl(header(3), message(4, "continued")),
    jsonl(header(0), message(1, "same text"), message(2, "same text")),
    jsonl(header(0), message(1, "same text")),
  ]);
  const lines = contents
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line));
  expect(lines).toHaveLength(4);
  expect(lines[0].payload).toMatchObject({
    id: targetProviderThreadId,
    session_id: targetProviderThreadId,
    cwd: "/destination/project",
    opaque: { preserved: true },
  });
  expect(lines.slice(1).map((line) => line.ordinal)).toEqual([1, 2, 4]);
});

it("refuses malformed, mixed-identity, or ambiguous native histories instead of truncating them", () => {
  expect(() => prepare([jsonl(header(0)) + "\n{partial"])).toThrow();
  expect(() =>
    prepare([
      jsonl({
        ...header(0),
        payload: { ...header(0).payload, id: randomUUID() },
      }),
    ]),
  ).toThrow(/different session/);
  expect(() =>
    prepare([
      jsonl(header(0), message(1, "one")),
      jsonl(header(0), message(1, "two")),
    ]),
  ).toThrow(/conflicting/);
  expect(() =>
    prepare([
      jsonl(header(0)),
      jsonl({ type: "session_meta", payload: header(0).payload }),
    ]),
  ).toThrow(/without sequence/);
});

it("installs atomically with private permissions and only accepts identical retries", async () => {
  const codexHome = await mkdtemp(
    path.join(tmpdir(), "kaioken-native-transfer-"),
  );
  directories.push(codexHome);
  const contents = prepare([jsonl(header(0), message(1, "context"))]);
  const args = {
    codexHome,
    contents,
    providerThreadId: targetProviderThreadId,
  };
  const target = await installTransferredCodexSession(args);
  expect(await readFile(target, "utf8")).toBe(contents);
  expect((await stat(target)).mode & 0o777).toBe(0o600);
  expect(await installTransferredCodexSession(args)).toBe(target);
  await expect(
    installTransferredCodexSession({
      ...args,
      contents: prepare([jsonl(header(0), message(1, "different"))]),
    }),
  ).rejects.toThrow(/different Codex session/);
  expect(await readdir(path.dirname(target))).toEqual([path.basename(target)]);
  expect(await readdir(codexHome)).toEqual(["sessions"]);
});
