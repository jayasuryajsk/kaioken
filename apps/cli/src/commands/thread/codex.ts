import { Command } from "commander";
import { action } from "../../action.js";
import { createCliBbSdk } from "../../client.js";
import { outputJson, requireThreadIdOrSelf } from "../helpers.js";

interface ThreadCodexCommandOptions {
  self?: boolean;
  json?: boolean;
}

export function registerCodexCommands(
  parent: Command,
  getUrl: () => string,
): void {
  const codex = parent
    .command("codex")
    .description("Move a Codex thread between Kaioken and the Codex CLI");

  codex
    .command("show [id]")
    .description("Show how a thread is linked to its Codex session")
    .option("--self", "Target the current thread (from KAIOKEN_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadCodexCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const link = await createCliBbSdk(getUrl()).threads.codex.link({
            threadId,
          });
          if (outputJson(opts, link)) return;
          console.log(`Thread: ${link.threadId}`);
          console.log(`Codex session: ${link.providerThreadId ?? "-"}`);
          console.log(`Imported from: ${link.sourceProviderThreadId ?? "-"}`);
          console.log(`Handoff: ${link.handoffState ?? "none"}`);
        },
      ),
    );

  codex
    .command("handoff [id]")
    .description(
      "Copy the thread's Codex session into ~/.codex so `codex resume` can continue it",
    )
    .option("--self", "Target the current thread (from KAIOKEN_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadCodexCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const result = await createCliBbSdk(getUrl()).threads.codex.handoff({
            threadId,
          });
          if (outputJson(opts, result)) return;
          console.log(`Handed off ${result.threadId} to Codex.`);
          console.log(`Rollout: ${result.rolloutPath}`);
          console.log(
            result.hostIsServer
              ? `Continue in Codex with: ${result.command}`
              : `Continue in Codex on ${result.hostName ?? result.hostId ?? "that machine"} with: ${result.command}`,
          );
          console.log(
            "Run `kaioken thread codex sync` when you come back so Kaioken picks up the Codex turns.",
          );
        },
      ),
    );

  codex
    .command("sync [id]")
    .description(
      "Pull turns that Codex added since the handoff back into the thread",
    )
    .option("--self", "Target the current thread (from KAIOKEN_THREAD_ID)")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(
        async (id: string | undefined, opts: ThreadCodexCommandOptions) => {
          const threadId = requireThreadIdOrSelf(id, opts);
          const result = await createCliBbSdk(getUrl()).threads.codex.sync({
            threadId,
          });
          if (outputJson(opts, result)) return;
          console.log(
            result.appendedTurns === 0
              ? `Thread ${result.threadId} is already up to date with Codex.`
              : `Synced ${result.appendedTurns} Codex turn${result.appendedTurns === 1 ? "" : "s"} (${result.appendedEvents} events) into ${result.threadId}.`,
          );
        },
      ),
    );
}
