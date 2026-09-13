import { Command } from "commander";
import type { ThreadSectionResponse } from "@kaioken/server-contract";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { renderBorderlessTable } from "../table.js";
import { confirmDestructiveAction, outputJson } from "./helpers.js";

interface JsonOptions {
  json?: boolean;
}

interface RemoveOptions extends JsonOptions {
  yes?: boolean;
}

export type LabelMemberKind = "repo" | "thread";

export function classifyLabelMemberId(id: string): LabelMemberKind {
  if (id.startsWith("proj_")) return "repo";
  if (id.startsWith("thr_")) return "thread";
  throw new Error(
    `Unknown member id ${id}: labels hold repos (proj_...) and threads (thr_...).`,
  );
}

export function resolveLabel(
  sections: readonly ThreadSectionResponse[],
  reference: string,
): ThreadSectionResponse {
  const byId = sections.find((section) => section.id === reference);
  if (byId) return byId;
  const wanted = reference.trim().toLowerCase();
  const byName = sections.filter(
    (section) => section.name.trim().toLowerCase() === wanted,
  );
  if (byName.length === 1) return byName[0]!;
  if (byName.length > 1) {
    throw new Error(
      `Label name "${reference}" is ambiguous; use one of: ${byName
        .map((section) => section.id)
        .join(", ")}`,
    );
  }
  const known = sections.map((section) => `${section.name} (${section.id})`);
  throw new Error(
    known.length === 0
      ? `No label matches "${reference}"; create one with kaioken labels add <name>.`
      : `No label matches "${reference}". Known labels: ${known.join(", ")}`,
  );
}

function printLabels(sections: readonly ThreadSectionResponse[]): void {
  if (sections.length === 0) {
    console.log("No labels yet. Create one with kaioken labels add <name>.");
    return;
  }
  const rows = sections.map((section) => [
    section.name,
    section.id,
    section.projectIds.length === 0 ? "-" : section.projectIds.join(", "),
  ]);
  const widths = [0, 1, 2].map((column) =>
    Math.max(
      ["Name", "ID", "Repos"][column]!.length,
      ...rows.map((row) => row[column]!.length),
    ),
  );
  console.log(
    renderBorderlessTable(
      {
        head: ["Name", "ID", "Repos"],
        colWidths: widths,
        trimTrailingWhitespace: true,
      },
      rows,
    ),
  );
}

export function registerLabelCommands(
  program: Command,
  getUrl: () => string,
): void {
  const labels = program
    .command("labels")
    .description(
      "Manage sidebar labels that group repos and threads across machines",
    );

  labels
    .command("list")
    .description("List labels with the repos they hold")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (opts: JsonOptions) => {
        const sections = await createCliBbSdk(getUrl()).threadSections.list();
        if (outputJson(opts, sections)) return;
        printLabels(sections);
      }),
    );

  labels
    .command("add <name>")
    .description("Create a label")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (name: string, opts: JsonOptions) => {
        const result = await createCliBbSdk(getUrl()).threadSections.create({
          name,
        });
        if (outputJson(opts, result)) return;
        console.log(`Label ${result.id} created: ${result.name}`);
      }),
    );

  labels
    .command("rename <label> <name>")
    .description("Rename a label, referenced by id or current name")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (reference: string, name: string, opts: JsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const label = resolveLabel(await sdk.threadSections.list(), reference);
        const result = await sdk.threadSections.update({ id: label.id, name });
        if (outputJson(opts, result)) return;
        console.log(`Label ${result.id} renamed: ${result.name}`);
      }),
    );

  labels
    .command("remove <label>")
    .description(
      "Remove a label; its repos and threads return to their machines",
    )
    .option("--yes", "Skip the confirmation prompt")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (reference: string, opts: RemoveOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const label = resolveLabel(await sdk.threadSections.list(), reference);
        if (
          !opts.yes &&
          !(await confirmDestructiveAction(
            `Remove label ${label.name} (${label.id})?`,
          ))
        )
          return;
        const result = await sdk.threadSections.delete({ id: label.id });
        if (outputJson(opts, result)) return;
        console.log(
          `Label ${result.id} removed; ${result.updatedProjectCount} repo(s) and ${result.updatedThreadCount} thread(s) returned to their machines`,
        );
      }),
    );

  labels
    .command("move <label> <id...>")
    .description("Move repos (proj_...) or threads (thr_...) into a label")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (reference: string, ids: string[], opts: JsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const label = resolveLabel(await sdk.threadSections.list(), reference);
        const moved = await assignMembers(sdk, ids, label.id);
        if (outputJson(opts, { label, moved })) return;
        for (const member of moved) {
          console.log(`${member.kind} ${member.id} -> ${label.name}`);
        }
      }),
    );

  labels
    .command("unlabel <id...>")
    .description("Remove repos or threads from whatever label holds them")
    .option("--json", "Print machine-readable JSON output")
    .action(
      action(async (ids: string[], opts: JsonOptions) => {
        const sdk = createCliBbSdk(getUrl());
        const moved = await assignMembers(sdk, ids, null);
        if (outputJson(opts, { moved })) return;
        for (const member of moved) {
          console.log(`${member.kind} ${member.id} -> no label`);
        }
      }),
    );
}

async function assignMembers(
  sdk: ReturnType<typeof createCliBbSdk>,
  ids: readonly string[],
  sectionId: string | null,
): Promise<{ kind: LabelMemberKind; id: string }[]> {
  const members = ids.map((id) => ({ kind: classifyLabelMemberId(id), id }));
  for (const member of members) {
    if (member.kind === "repo") {
      await sdk.projects.update({ projectId: member.id, sectionId });
    } else {
      await sdk.threads.update({ threadId: member.id, sectionId });
    }
  }
  return members;
}
