---
name: kaioken-cli
description: "Inspect or manage Kaioken state with the kaioken CLI; use for Kaioken commands and configuration."
---

# Kaioken CLI

Use kaioken for Kaioken state and actions. Inspect context when the target project, host,
workspace, or execution selection is not already established.

## Start with context

```sh
kaioken status --json
```

Use JSON when command output controls later work. Use human output for quick
inspection.

Run `kaioken --version` for the CLI version. Use `kaioken --help` or `kaioken help [command]`
for help. Run kaioken guide for the system overview. Run kaioken guide <chapter> for one
area. Use kaioken <group> --help for current flags and defaults.

A standalone CLI targets http://127.0.0.1:38886. Use KAIOKEN_SERVER_URL and
KAIOKEN_HOST_DAEMON_PORT only for an intentional non-default target.

## Read only the relevant reference

- Read references/command-index.md to find the exact core command path. Use
  live help for current flags and defaults.
- Read references/configuration.md for settings, agent instructions, skills,
  remote clients, and environment setup scripts.
- Read references/thread-creation.md before you spawn or fork threads, create
  projects, select machines, or create environments.
- Read references/thread-operation.md for messages, queues, interactions,
  panes, terminals, inspection, and long-running commands.
- Read references/failure-recovery.md when a thread fails, stops, or needs plan
  or goal recovery.
- Read references/theme-commands.md for palette and favicon commands. Read
  references/theming.md before you create or edit theme CSS.
- Read references/plugins.md for plugin discovery, install, build, update,
  configuration, runtime, and contributed commands.
- Read references/app-settings.md for complete app setting keys and effects.

## Command habits

- Resolve names and IDs with a list or show command before mutation.
- Pass an explicit project when a command can act across projects.
- Pass an environment or machine selector when the default host is uncertain.
- Spawn onto a plugin-provisioned environment with
  `kaioken thread spawn --environment-provider <id>` (list them with
  `kaioken environment providers`).
  Read the provider's `requires` (`projectCheckout`, `gitCheckout`, `gitRemote`,
  `projectless`): these facts decide where
  the provider is offered. A provider whose `inputs` schema does not accept an
  empty object needs `--environment-inputs <json>` matching that JSON Schema;
  providers that accept `{}` use it when the flag is omitted
  (`kaioken environment providers --json` prints both facts). `--base-branch`
  belongs to `--new-environment worktree` only.
- `kaioken environment providers` lists Project checkout, Worktree, then other
  installed providers by display name. With `--project <id> --machine <id>`
  it also prints that machine's availability (`available`, `setup-required`,
  `unavailable`, or `unknown` until the background probe answers). Read or set `managedBranchPrefix`
  through `kaioken settings show` and `kaioken settings general <key> <value>`.
- The server keeps a registry of sidebar layout preferences (organization
  mode, section order, collapsed rows, navigation entries): `kaioken settings ui
list`, `get`, `set`, and `reset`. `sidebar.organizationMode connection`
  groups repos under their machines.
- Sections double as labels holding repos and threads from any machine:
  `kaioken labels list|add|rename|remove|move|unlabel`; `move` takes a label id
  or name plus `proj_...`/`thr_...` ids.
- Query provider models on the machine that will run the thread.
- Prefer non-interactive commands and machine-readable output for automation.
- Pass `--yes` for a confirmed destructive command in a non-interactive shell.
- Treat plugin commands as normal top-level commands after installation.

- Inspect real status, logs, API results, or diffs instead of assumptions.
- For launcher startup errors and console output, read `logs/server-stdio.log`
  or `logs/host-daemon-stdio.log` under the selected kaioken data directory. These
  append across restarts; `kaioken-app`, `kaioken-server`, and `kaioken-host-daemon` capture
  service output there instead of forwarding it to their terminal.
- Keep file paths on the machine that owns the selected workspace.
- `kaioken connection list` discovers separate Kaioken installations;
  `connection inspect [url]` reads their stable identity. `connection ssh
list|connect|disconnect` manages connections through the controller's OpenSSH
  configuration. Connect returns the initial state; follow with `connection ssh
list --json`, then use the reported URL with `--url` for normal commands.
  Opening or disconnecting a workspace never moves or stops its tasks.
- Worker enrollment is separate: `kaioken machine` manages execution daemons
  enrolled in one server. Settings → Connections keeps this under Advanced:
  execution workers. Installation commands are generated only on request.

## Common checks

```sh
kaioken project list --json
kaioken machine list --json
kaioken environment providers --json
kaioken provider list --environment "$BB_ENVIRONMENT_ID" --json
kaioken thread show "$BB_THREAD_ID" --json
kaioken environment status "$BB_ENVIRONMENT_ID" --json
kaioken plugin list --json
kaioken skill list --environment "$BB_ENVIRONMENT_ID" --json
```

## Completion

Confirm the command result and any affected thread, environment, plugin, or
remote service. Report the stable ID or URL that the user needs next.

`kaioken environment show <id>` reports core-owned lifecycle, retirement deadline and teardown attempts. Archive/delete of the last live thread starts the provider grace; unarchive cancels pending retirement. Teardown errors remain visible and retry automatically. `kaioken environment delete <id>` requests cleanup immediately, including under a never-retire policy; destroyed is recorded after cleanup completes. Removal waits for live or stopping runtimes. Project source deletion remains available during project deletion, including removal of the last source, so providers can finish cleanup.

## Plugin configuration

Use `kaioken plugin config <id>` to inspect the plugin’s configuration and
`kaioken plugin config <id> set <key> <value>` to change it. Read the plugin’s own
skill for its commands, configuration meanings, and operating constraints.
Discover contributed command paths through `kaioken plugin list`, the generated
`plugin-commands` skill, or `kaioken plugin run <id> --help`.

Keep this skill and its references focused on core Kaioken commands. Plugin-specific
behavior belongs in the owning plugin’s `skills/` directory, including built-in
plugins; do not add plugin command manuals here.

## Built-in browser control

Use `kaioken browser instances --host <host-id> --json` to discover a desktop. Commands `tabs`, `create`, `acquire`, `connection`, `release`, `reveal`, `capture`, `close`, and `watch` require explicit `--host`, `--instance`, `--generation`, and `--thread`. See `kaioken guide browser` and `kaioken browser --help` for flags. New tabs use separate automation profiles; personal-tab control needs an explicit handoff. Revealing tabs or acquiring control opens the side panel and selects the tab only in the already focused thread, without switching threads or activating the desktop window. Connection credentials are written with `connection --output <new-file>` and work only on the browser host; keep them out of chat and public port shares. `import-sources` and `import-cookies --from <source> --profile <dir> [--into personal|automation:<id>]` copy signed-in cookies from an installed browser into a Kaioken browser profile; they need `--host`, `--instance`, and `--generation` only, and the source browser must be quit first.

- `kaioken connection handoff <task-id> --to <computer> --preview --json` lists
  matching destination projects. Remove `--preview` and optionally pass
  `--project <id>` and `--wait` to move native Codex context, attachments, and Git
  state into a new worktree. `--from` defaults to `local`; targets accept `local`,
  account handles, or `ssh.<alias>`. `--id <uuid>` makes start retries idempotent.
  `connection handoff-status|handoff-retry|handoff-cancel <operation-id>` supports
  `--json`. Failed moves preserve the source; confirm destination cancellation
  before releasing it. This implementation supports native Codex sessions.
