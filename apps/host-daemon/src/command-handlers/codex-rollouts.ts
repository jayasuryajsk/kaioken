import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import type {
  CodexRolloutHome,
  HostDaemonOnlineRpcResult,
} from "@kaioken/host-daemon-contract";
import {
  copyRolloutsToHome,
  findRolloutsInHomes,
  lastRolloutOrdinal,
  resolveCodexHomes,
  type CodexHomes,
} from "@kaioken/codex-rollout/files";
import type { CommandOf } from "../command-dispatch-support.js";

function homesFor(homes: CodexHomes | undefined): CodexHomes {
  return homes ?? resolveCodexHomes({ env: process.env, homeDir: homedir() });
}

export async function locateCodexRollouts(
  command: CommandOf<"codex.rollouts.locate">,
  homes?: CodexHomes,
): Promise<HostDaemonOnlineRpcResult<"codex.rollouts.locate">> {
  const files = findRolloutsInHomes(
    homesFor(homes),
    command.providerThreadId,
    command.homes,
  );
  if (files === null) return { rollouts: null };
  return {
    rollouts: {
      home: files.homeKey satisfies CodexRolloutHome,
      paths: files.paths,
      lastOrdinal: lastRolloutOrdinal(files.paths),
    },
  };
}

export async function copyCodexRollouts(
  command: CommandOf<"codex.rollouts.copy">,
  codexHomes?: CodexHomes,
): Promise<HostDaemonOnlineRpcResult<"codex.rollouts.copy">> {
  const homes = homesFor(codexHomes);
  const files = findRolloutsInHomes(homes, command.providerThreadId, [
    command.from,
  ]);
  if (files === null) return { copied: null };
  const paths = copyRolloutsToHome(files, homes[command.to]);
  return { copied: { paths, lastOrdinal: lastRolloutOrdinal(paths) } };
}

export async function readCodexRollouts(
  command: CommandOf<"codex.rollouts.read">,
  homes?: CodexHomes,
): Promise<HostDaemonOnlineRpcResult<"codex.rollouts.read">> {
  const files = findRolloutsInHomes(homesFor(homes), command.providerThreadId, [
    command.home,
  ]);
  if (files === null) return { rollouts: null };
  const contents = await Promise.all(
    files.paths.map((path) => readFile(path, "utf8")),
  );
  return {
    rollouts: {
      paths: files.paths,
      contents,
      lastOrdinal: lastRolloutOrdinal(files.paths),
    },
  };
}
