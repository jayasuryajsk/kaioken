---
kind: instruction
title: kaioken Guide — Machines
summary: Command reference for listing and targeting execution machines.
intent: Explain execution-machine discovery and selection from the CLI.
editingNotes: Keep the user-facing noun machine; internal APIs and types use Host.
---

Computer connections

Sign into GitHub in Settings → Connections on each computer. Projects and tasks
appear automatically in one sidebar; no pairing code is needed. Opening a remote
task uses the main conversation view, and replies, approvals and stop actions go
to its owning computer. Creating a task in a remote project uses that computer's
providers and models. Each installation keeps its files and provider credentials.
SSH connections are also available for computers configured in OpenSSH.

kaioken connection list [--json] List account computers
kaioken connection inspect [url] [--json] Read a server's stable identity
kaioken connection ssh list [--json] List SSH aliases and connection state
kaioken connection ssh connect <alias> Start connecting to a computer
--port <port> Remote Kaioken port (default 38886)
--json Print the initial connection state
kaioken connection ssh disconnect <alias> Close and forget its SSH tunnel

SSH reads concrete aliases from ~/.ssh/config and its Include files. The remote
login shell needs kaioken-app installed and its provider signed in. SSH uses your
existing keys and known hosts. Resolve sign-in or host-key failures with ssh in
your terminal, then retry. Transient network failures reconnect automatically;
saved connections reconnect when the controller starts using them after restart.
Disconnect closes the tunnel, not the remote Kaioken runtime or its tasks.

Follow setup with `kaioken connection ssh list --json`. To use any normal CLI
command on that computer, pass its reported URL with the global `--url` option.
The connected workspace requires a compatible Kaioken version on both computers.

Execution-worker commands

A machine is a host daemon that can run thread environments. Add remote
machines under Settings → Connections → Advanced: execution workers.

The server listens on loopback by default. Remote execution machines need the
account-gated kaioken connect route or a private Tailscale Serve URL; generate their
installer while using that reachable server URL.

The Settings installer first uses the exact `kaioken-app` tarball served by that kaioken
server at `/install/kaioken-app.tgz`; only servers that do not implement the route
(HTTP 404) fall back to the npm registry. npm installs kaioken-app under this
machine enrollment's kaioken data directory, so the installer needs neither `sudo`
nor a global npm configuration. Installed launchd/systemd services pass
`--auto-update`. On a newer server protocol mismatch, the daemon downloads that
same artifact, updates its private install, and exits for the service manager to
restart. Failed attempts use a persisted exponential backoff that starts at 5
seconds and caps at 5 minutes. A daemon never auto-downgrades to an older server
protocol. Use Settings → Connections → Advanced: execution workers or `kaioken machine retry-update` to bypass the
current backoff after a transient failure.

To opt out, remove `--auto-update` from the launchd plist or systemd user unit
and reload that service. Foreground/manual `kaioken-app host-daemon` runs leave it off
unless you pass `--auto-update` explicitly.

`kaioken-app`, `kaioken-server`, and `kaioken-host-daemon` capture service stdout and stderr
directly under the selected data directory in `logs/server-stdio.log` and
`logs/host-daemon-stdio.log`. These files append across restarts and contain
console output and startup errors; rotating application logs remain separate.
Use `tail -F` to follow them without coupling service logging to the terminal.

kaioken machine list List machines with ID, connection
status, and relative last-seen time
--json Print the raw host list
kaioken machine show <id-or-name> Show machine details
kaioken machine join-code Create a machine pairing code
kaioken machine rename <id-or-name> <name> Rename a machine
kaioken machine retry-update <id-or-name> Retry a pending daemon update now
kaioken machine remove <id-or-name> [--yes] Revoke and remove a machine
kaioken machine provider-cli status <machine>
kaioken machine provider-cli install <machine> <claudeCode|codex|cursor>
--action <install|update>

Each machine has a permission limit: the highest permission mode any thread on
that machine can run with. The default is Full Access. A thread that asks for
more resolves down to the limit, and a provider that supports no mode under the
limit cannot run there. Set it in Settings → Connections → Advanced: execution workers → the machine → Permission
limit; that page also shows the machine's projects, provider CLIs, update state,
and rename/remove. There is no CLI or SDK command to set it, and a paired
machine cannot set it for any machine, so a sandbox machine can stay at Full
Access while your laptop stays lower. `kaioken machine list --json` and `kaioken machine
show` report the current limit.

Updates commands

One consolidated view of kaioken and provider CLI updates across machines — the
CLI counterpart of Settings → Updates and the sidebar Updates badge.

kaioken updates [status] Show kaioken-app and provider CLI update
status for every machine
--machine <id-or-name> Limit to one machine
--json Print the aggregate as JSON
kaioken updates apply Run every available provider CLI
install/update, one at a time
--machine <id-or-name> Limit to one machine
--json Print per-target results as JSON

`kaioken updates apply` covers provider CLIs only. Update kaioken-app itself with the
printed upgrade command (`npx kaioken-app@latest`) or the desktop app's relaunch;
connected daemons then follow the server version automatically.

Machine selectors accept either an exact machine ID or an unambiguous machine
name. `--host` is an alias for `--machine`.

kaioken thread spawn --project <id> --machine <id-or-name> --prompt "..."
kaioken project create --name "..." --root <path> --machine <id-or-name>
kaioken project source add <projectId> --machine <id-or-name> --path <path>

For thread spawning, machine targeting works with an unmanaged workspace path,
a new managed worktree, or the personal workspace. Do not combine it with an
existing environment ID: the reused environment already selects its machine.

For project creation and sources, `--root`/`--path` refers to a path on the
selected connected machine. Omit the selector to keep the existing local CLI
machine fallback (normally the primary machine). Pass `--clone` to source add
instead of `--path` to clone the project's Git remote there; `--remote-url` and
`--target-path` optionally override the clone inputs.

## Move a Codex task

Use `kaioken connection handoff <task-id> --to <computer> --preview --json` to
find saved destination projects with the same Git remote and subdirectory.
Then run `connection handoff <task-id> --to <computer> --project <id> --wait`.
One matching project is selected automatically. `--from` defaults to `local`;
computer values are `local`, an account handle, or `ssh.<alias>`. `--id <uuid>`
keeps an uncertain start idempotent. `--json` returns structured progress.

`connection handoff-status <id>`, `handoff-retry <id>`, and `handoff-cancel <id>`
inspect or recover an operation; each supports `--json`. Handoff pauses the source,
copies native Codex context, conversation attachments and non-ignored Git changes,
and resumes in a new destination worktree. Staged changes stay staged. The source
is archived after the destination is ready, and its checkout is retained.
Failures preserve the source; cancellation requires destination confirmation.
Each computer uses its own Codex credentials. Other providers, Git submodules,
and Git LFS are not supported. Oversized histories fail at the existing 8 MiB
history limit without truncation. The restored worktree is attached and skips
environment setup/teardown hooks; transfer files remain available for recovery.
