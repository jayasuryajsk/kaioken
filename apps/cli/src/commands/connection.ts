import { Command } from "commander";
import { randomUUID } from "node:crypto";
import { action } from "../action.js";
import { createCliBbSdk } from "../client.js";
import { outputJson } from "./helpers.js";

export function registerConnectionCommands(
  program: Command,
  getUrl: () => string,
): void {
  const connection = program
    .command("connection")
    .description("Connect to Kaioken computers and inspect their identity");
  const ssh = connection
    .command("ssh")
    .description("Use OpenSSH hosts from this computer");
  connection
    .command("handoff <threadId>")
    .description(
      "Move a native Codex task and Git changes to a matching project on another computer",
    )
    .requiredOption(
      "--to <computer>",
      "Destination account handle, ssh.<alias>, or local",
    )
    .option(
      "--from <computer>",
      "Source account handle, ssh.<alias>, or local",
      "local",
    )
    .option(
      "--project <id>",
      "Destination project; selected automatically when exactly one matches",
    )
    .option("--id <uuid>", "Stable operation identity for an idempotent retry")
    .option("--preview", "List matching projects without moving the task")
    .option("--wait", "Wait until the move finishes or needs attention")
    .option("--json", "Print machine-readable JSON")
    .action(
      action(
        async (
          threadId: string,
          options: {
            to: string;
            from: string;
            project?: string;
            id?: string;
            preview?: boolean;
            wait?: boolean;
            json?: boolean;
          },
        ) => {
          const area = createCliBbSdk(getUrl()).experimental_connections;
          const sourceHandle = options.from === "local" ? null : options.from;
          const destinationHandle = options.to === "local" ? null : options.to;
          const [sourceIdentity, destinationIdentity] = await Promise.all([
            area.resolve({ handle: sourceHandle }),
            area.resolve({ handle: destinationHandle }),
          ]);
          const input = {
            source: { handle: sourceHandle, serverId: sourceIdentity.serverId },
            sourceThreadId: threadId,
            destination: {
              handle: destinationHandle,
              serverId: destinationIdentity.serverId,
            },
          };
          const preview = await area.handoffs.preview(input);
          if (options.preview) {
            if (!outputJson(options, preview))
              for (const project of preview.projects)
                console.log(
                  `${project.id} · ${project.name} · ${project.path}`,
                );
            return;
          }
          const projectId =
            options.project ??
            (preview.projects.length === 1
              ? preview.projects[0]?.id
              : undefined);
          if (!projectId)
            throw new Error(
              "Choose a matching destination project with --project. Use --preview to list matches.",
            );
          const id = options.id ?? randomUUID();
          console.error(`Handoff ${id}`);
          let status = await area.handoffs.start({
            ...input,
            id,
            destinationProjectId: projectId,
          });
          while (
            options.wait &&
            !["complete", "failed", "cancelled"].includes(status.phase)
          ) {
            await new Promise((resolve) => setTimeout(resolve, 1000));
            status = await area.handoffs.get({ id });
          }
          if (!outputJson(options, status))
            console.log(
              `${status.id} · ${status.phase}${status.destinationThreadId ? ` · task ${status.destinationThreadId}` : ""}${status.error ? ` · ${status.error}` : ""}`,
            );
          if (status.phase === "failed") process.exitCode = 1;
        },
      ),
    );
  for (const actionName of ["status", "retry", "cancel"] as const) {
    connection
      .command(`handoff-${actionName} <id>`)
      .description(
        `${actionName === "status" ? "Inspect" : actionName === "retry" ? "Retry" : "Cancel"} a task handoff`,
      )
      .option("--json", "Print machine-readable JSON")
      .action(
        action(async (id: string, options: { json?: boolean }) => {
          const handoffs =
            createCliBbSdk(getUrl()).experimental_connections.handoffs;
          const result = await handoffs[
            actionName === "status" ? "get" : actionName
          ]({ id });
          if (!outputJson(options, result))
            console.log(
              `${result.id} · ${result.phase}${result.error ? ` · ${result.error}` : ""}`,
            );
        }),
      );
  }
  ssh
    .command("list")
    .option("--json", "Print machine-readable JSON")
    .action(
      action(async (options: { json?: boolean }) => {
        const result =
          await createCliBbSdk(getUrl()).experimental_connections.ssh.list();
        if (outputJson(options, result)) return;
        for (const alias of new Set([
          ...result.aliases,
          ...result.connections.map((entry) => entry.alias),
        ])) {
          const current = result.connections.find(
            (entry) => entry.alias === alias,
          );
          console.log(
            `${alias} · ${current?.state ?? "Available"}${current?.url ? ` · ${current.url}` : ""}${current?.error ? ` · ${current.error}` : ""}`,
          );
        }
      }),
    );
  ssh
    .command("connect <alias>")
    .option("--port <port>", "Kaioken port on the remote computer", "38886")
    .option("--json", "Print machine-readable JSON")
    .action(
      action(
        async (alias: string, options: { port: string; json?: boolean }) => {
          const result = await createCliBbSdk(
            getUrl(),
          ).experimental_connections.ssh.connect({
            alias,
            remotePort: Number(options.port),
          });
          if (!outputJson(options, result))
            console.log(
              `${result.alias}: ${result.state}. Use kaioken connection ssh list to follow its status.`,
            );
        },
      ),
    );
  ssh
    .command("disconnect <alias>")
    .option("--json", "Print machine-readable JSON")
    .action(
      action(async (alias: string, options: { json?: boolean }) => {
        const result = await createCliBbSdk(
          getUrl(),
        ).experimental_connections.ssh.disconnect({ alias });
        if (!outputJson(options, result))
          console.log(
            `Disconnected from ${alias}. Tasks continue on that computer.`,
          );
      }),
    );
  connection
    .command("list")
    .description("List computers on the connected account")
    .option("--json", "Print machine-readable JSON")
    .action(
      action(async (options: { json?: boolean }) => {
        const result =
          await createCliBbSdk(getUrl()).experimental_connections.list();
        if (outputJson(options, result)) return;
        console.log(`This Kaioken: ${result.self.serverId}`);
        if (result.discovery === null) {
          console.log(
            "Account discovery unavailable. Set up remote access with kaioken connect.",
          );
          return;
        }
        for (const server of result.discovery.servers)
          console.log(
            `${server.name} (${server.handle}) · ${server.live ? "Online" : "Offline"} · ${server.url}`,
          );
      }),
    );
  connection
    .command("inspect [url]")
    .description("Read a computer's stable identity and workspace protocol")
    .option("--json", "Print machine-readable JSON")
    .action(
      action(async (url: string | undefined, options: { json?: boolean }) => {
        const result = await createCliBbSdk(
          url ?? getUrl(),
        ).experimental_connections.self();
        if (outputJson(options, result)) return;
        console.log(
          `Server: ${result.serverId}\nPrimary host: ${result.primaryHostId ?? "Unavailable"}\nWorkspace protocol: ${result.workspaceProtocol}`,
        );
      }),
    );
}
