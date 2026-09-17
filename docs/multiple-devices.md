# Using kaioken on multiple devices

Kaioken distinguishes control devices, connected computers and execution workers:

- A browser device is a control surface for one kaioken server. It can view projects,
  send prompts, and manage threads, but it does not execute them.
- A connected computer is another Kaioken installation. Settings → Connections
  manages account devices. Their projects and tasks share one sidebar, and
  remote conversations open in the main interface. Data and execution stay
  on the owning computer.
- An execution machine runs a host daemon. One kaioken server can dispatch project
  sources and thread environments across several enrolled machines.

A browser or desktop app can control multiple installations. Use Connections
for ordinary computer access and its Advanced: execution workers section when
one server should manage a separate host daemon.

## Sign in on each computer

On each Mac, open Settings → Connections → **Continue with GitHub**. The browser
shows the computer being connected, then asks for GitHub authorization. Return
to Kaioken after success; the app completes registration automatically. Use the
same configured GitHub account on both computers. Other computers appear through
live discovery. Open projects or tasks directly from the shared sidebar; no
connection code or separate Connect step is needed. Keep the remote
Kaioken runtime running; a sleeping or offline computer remains unavailable.

The personal service's OAuth setup is documented in [relay setup](../apps/relay/README.md).
This implementation requires that configured relay and updated clients; it does
not add sign-in to previously installed releases. It supports one configured
owner, not public account creation. Connecting does not copy repositories or
provider API keys between computers.

Connections settings offers **Rename** and **Revoke** for each computer, and
**Sign out** revokes the current computer before removing its credential.
Revoking removes its account access and closes its tunnel; it does not delete
local projects or tasks. Signing in again grants a new device credential.

```sh
kaioken connect login --name "Mac Studio"
kaioken connect login --cancel
kaioken connect status --json
kaioken connect servers --json
kaioken connect rename <handle> --name "MacBook"
kaioken connect revoke <handle>
kaioken connect logout
```

Login prints a browser link and finishes in the runtime, so the CLI need not stay
open. All commands above accept `--json`. `logout` confirms revocation with the
relay; a network failure leaves credentials available for retry. The older
`off` command clears local pairing even if cloud revocation cannot be confirmed.

GitHub device credentials and pending login proofs are stored atomically in
owner-readable files (0600) under `<dataDir>/plugins/connect/secrets/`; the daemon
can resume without an unlocked desktop window. The desktop's separate credential
cache uses its existing OS-backed safeStorage. Legacy code-paired credentials
remain compatible. Do not copy these files to another installation.

SDK clients can call Connect RPCs `beginSignIn` (`{name?}`), `signInStatus`,
`cancelSignIn`, `renameDevice` (`{handle,name}`), and `revokeDevice` (`{handle}`)
through `sdk.plugins.callRpc`. Login status uses `connectLoginStatusSchema` from
`@kaioken/connect-client` and exposes no proof or device credential. Subscribe to
`account-login` for login status and `account-servers` for discovery snapshots.

## Work across computers

Remote tasks use the same timeline and prompt components as local tasks. Replies,
attachments, approvals and stop actions go to the owning computer. Selecting a
remote project uses its machines, providers and model catalog for new tasks.
Drafts are stored separately per computer and task. The device list and remote
sidebar snapshots update from events, with a slow refresh as a recovery fallback.

The existing SDK works against each discovered server URL: create a browser SDK
with that base URL and authenticated transport, then use `projects.sidebarBootstrap`,
`threads.get`, `threads.timeline`, `threads.send`, `threads.interactions.resolve`,
`threads.stop`, and `threads.spawn`. CLI commands target the owning server with
`kaioken --url <server-url> ...`; `kaioken connection list --json` discovers devices.
Authentication is still required by that server; no credentials are copied into
navigation links.

## Move a task between computers

Choose **Move to computer** from a Codex task's menu. Select a connected computer
and a matching saved project. Kaioken stops the current turn, transfers native
Codex context, conversation attachments, and Git changes, then resumes an idle
task in a new destination worktree. Staged and unstaged changes remain separate;
non-ignored untracked files transfer too. Ignored files stay on the source.
The source task is archived only after the destination is ready. Its checkout is
retained. Closing the progress panel does not stop the transfer.
Task edits, queue changes, archival and deletion are blocked until the move
finishes or is cancelled. A move waits for an earlier task mutation to finish
before it can take its snapshot; retry if it reports that the task is busy.

Both computers need a current Kaioken runtime and a usable Codex installation.
The destination project must use the same Git remote and repository subdirectory.
Credentials and provider configuration belong to each computer and are not copied.
The first handoff implementation supports native Codex tasks. Submodules and Git
LFS are rejected before transfer. Conversation history is subject to the server's
8 MiB event-response limit; oversized histories fail without truncation.
Transferred worktrees are retained as attached environments and skip environment
setup/teardown hooks. Transfer files are retained for retry and recovery.

```sh
kaioken connection handoff <task-id> --to ssh.work --preview --json
kaioken connection handoff <task-id> --to ssh.work --project <project-id> --wait
kaioken connection handoff <task-id> --from <account-handle> --to local --wait
kaioken connection handoff-status <operation-id> --json
kaioken connection handoff-retry <operation-id>
kaioken connection handoff-cancel <operation-id>
```

Use `--id <uuid>` to retry an uncertain start with the same identity. `--from`
defaults to `local`; `--to` accepts `local`, an account handle, or `ssh.<alias>`.
If exactly one project matches, `--project` is optional. Failures preserve the
source task. Retry reconnects to the same operation; cancellation waits for the
destination before releasing the source. Once the destination has completed,
finish the operation with retry instead of cancelling.

## Connect with SSH

Open Settings → Connections → SSH connections on the controller computer. Select
an alias from its OpenSSH configuration and choose Connect. Kaioken checks for an
existing server and starts the installed `kaioken-app` from the remote login
shell when needed. Provider sign-in stays on the remote computer.

```bash
kaioken connection ssh list --json
kaioken connection ssh connect work --port 38886
kaioken connection ssh list --json
kaioken --url <reported-tunnel-url> project list --json
kaioken connection ssh disconnect work
```

The private tunnel binds to loopback on the controller. Existing SSH keys,
agent forwarding configuration and known-host checks remain OpenSSH's
responsibility. A sign-in or host-key error includes a recovery action; network
failures reconnect with backoff. Saved connections are restored when the
controller uses its connection manager after restart. Disconnect forgets the
connection and closes the tunnel; tasks continue on the remote computer.

Each server has a persistent installation UUID, available through
`kaioken connection inspect [url]`. If a saved URL changes identity, the workspace
asks you to connect again. Connected workspaces remain mounted while switching
computers, keeping their loaded history and drafts. Opening an unavailable
workspace reports its connection state.

In the desktop app, browser panes opened in a connected workspace use the
controller's native browser through a frame-scoped bridge. Tabs are isolated by
installation and workspace, and hidden when switching computers. Agent-owned
browser tabs remain bound to the desktop target that created them; the bridge
does not transfer their automation sessions or browser credentials.

## Open kaioken from another browser

The simplest managed route is **kaioken connect**. Pair the server from Settings →
Connections (or `kaioken connect --code ... --server
...`), then open its getbb.app URL. The server owns the tunnel and reconnects
after restart.

For a private tailnet route, keep kaioken on its loopback default and publish it
through Tailscale Serve:

```bash
tailscale serve --bg --https=443 http://127.0.0.1:38886
npx kaioken-app config set KAIOKEN_APP_URL https://<machine>.<tailnet>.ts.net
```

Start kaioken with `npx kaioken-app` and open the HTTPS URL. Tailscale ACLs are the access
boundary for this route; do not expose the server through Funnel or the public
internet. kaioken connect URLs require the paired account owner's session.

Existing remote host daemons that target a direct tailnet IP or
`http://<machine>.<tailnet>.ts.net:38886` must migrate before restarting an
upgraded server. Prefer pairing kaioken connect and re-adding the machine from
Settings → Connections → Advanced: execution workers so its installer records the account-gated route. The
private alternative is to open kaioken through the Tailscale Serve URL and re-run
the Add machine installer from there.

For compatibility only, `npx kaioken-app --server-bind-host 0.0.0.0` restores direct
IPv4 network access. The public API is unauthenticated and permits command
execution and file reads, so use wildcard binding only behind a trusted network
boundary and never through Funnel or the public internet.

Inside a container, `0.0.0.0` listens on the container's IPv4 interfaces; the
container runtime must still publish that port to the host (for example,
`docker run -p 3000:3000 ...`). Host firewall and upstream network rules also
remain separate from kaioken's bind setting.

### Use editors installed on the browser device

Local editor integration is optional. It connects the remote kaioken page to the
loopback-only helper started by the kaioken desktop app or `npx kaioken-app` on the
computer running the browser. The helper discovers installed editors and opens
paths without exposing its API to the network.

If that browser should open work-host files in its local editor, first make
sure kaioken is running on the browser device. Verify `ssh <work-host>` succeeds
there, then map the server/work-host to that SSH target:

```bash
npx kaioken-app client ssh-target set <kaioken-server-origin> <ssh-target> --host-id <work-host-id>
```

Copy the work-host ID from `kaioken machine list`. `--host-id` may be omitted when
the server has exactly one machine. A browser running on an enrolled execution
machine needs no SSH mapping for that same machine: connected daemons report
their helper ports to the server, and the browser discovers the matching local
helper after you enable integration.

Then open Settings → Files in that browser and enable **Local editor
integration**. The browser may ask once for permission to connect to software
on the computer. kaioken does not request that permission during normal remote page
loads; it is only needed for discovering and launching local editors.

If Settings reports that it cannot connect to the helper:

1. Confirm the kaioken desktop app or `npx kaioken-app` is running on the browser device.
2. Confirm the browser allows local network access for the kaioken page.
3. A helper enrolled with this exact server trusts its origin automatically.
   For a separate local kaioken helper serving a custom HTTPS or Tailscale browser,
   configure that exact origin with
   `npx kaioken-app config set KAIOKEN_APP_URL <origin>` and restart kaioken.
4. Return to Settings → Files and choose **Retry**.

Phones and tablets need no helper; editor-launch actions are simply unavailable.

## Use the kaioken mobile app

The kaioken mobile app is a client for a kaioken server; it runs nothing itself. Over
kaioken connect it pairs the same way the desktop app does: the phone enrolls as a
connect machine with its own credential, which the getbb.app dashboard lists
and can revoke.

1. Pair the kaioken server with kaioken connect first (Settings → Remote access, or
   `kaioken connect --code … --server …`).
2. Turn on the **Mobile app** experiment (Settings → Experiments, or
   `kaioken settings experiment mobileApp true`). Mobile pairing stays hidden
   without it while the app is in early access.
3. Mint a pairing code for the phone: Settings → Remote access → **Add mobile
   device** (QR code plus the code as text, with a countdown), or run
   `kaioken connect machine-code` (`--json` prints
   `{code, serverUrl, apex, expiresAt}`).
4. In the mobile app, add a server over kaioken connect and scan the QR code or type
   the code. Codes last 10 minutes and work once.

The phone keeps its credential in the device keychain and mints short-lived
sessions from it; it never holds the server's pairing secret. To cut a phone
off, revoke it in the getbb.app dashboard machine list. Every phone takes one of
the account's machine slots, so a machine-limit error means an unused device
should be revoked first. On a trusted network the app can also use a direct
server URL (Tailscale Serve or `--server-bind-host 0.0.0.0`) with the same
caveats as a browser. Platforms (iOS first) and what the phone cannot do are
listed in [platform-support.md](platform-support.md).

### Push notifications on a self-hosted server

The built-in Push notifications plugin sends messages through Expo. A
self-hosted server must reach `https://exp.host`. The server needs no Apple or
Google key.

An Expo push token lets its holder send a notification to one app installation.
The token cannot read notifications. It cannot access the phone or authenticate
to the kaioken server. Treat the token as private because a leak can cause unwanted
notifications.

The server sends a thread title and a short preview. Use these commands to
manage device registrations and inspect the sender:

```bash
kaioken push-notifications list
kaioken push-notifications add --token <expo-push-token> --platform ios --label <device-name>
kaioken push-notifications remove <id>
kaioken push-notifications status
```

Turn delivery off with `kaioken plugin disable push-notifications`. The plugin keeps
registrations in its private storage. Enable the plugin to resume delivery.

The `expoPushUrl` plugin setting changes the Expo endpoint. Use it only for a
controlled test service or a compatible relay:

```bash
kaioken plugin config push-notifications set expoPushUrl <url>
```

The Expo request supports `HTTPS_PROXY` and `NO_PROXY`.

## Open connected computers in the desktop app

Sign in with the same GitHub account on each computer. Their projects and tasks
appear in one sidebar, labeled with the computer that owns them. Opening a task
uses the normal conversation view, and creating a task in a remote project runs
it on that computer. Older workspace links redirect to these native routes.

The desktop app uses its existing Connect session, stored with OS keychain
protection, for authenticated HTTP and realtime requests. It never copies the
remote computer's provider credentials. Offline computers remain listed and
become available again when Kaioken reconnects.

Account discovery uses one Connect subscription per local runtime. Sidebar,
search, and project pickers share remote event subscriptions and cached snapshots.
Changes refresh the shared snapshot in a short batch, with a five-minute fallback
refresh for recovery. New computers do not wait for that fallback: account events
announce them immediately. `kaioken connect servers` and the Connect
`listAccountServers` SDK RPC read the same directory.

## Add an execution machine

Open Settings → Connections → Advanced: execution workers and choose Add machine. Run the generated one-line
installer on the computer that should
execute work. It installs and enrolls a host daemon; when kaioken connect is paired,
the installer also configures the machine credential used to reach the server
through the account gate. Without kaioken connect, open the server through a
Tailscale Serve URL before generating the installer; the loopback listener is
not directly reachable from another machine. When kaioken connect is not paired and
the server URL is a loopback or unspecified address, the dialog does not show an
installer. It links to Settings → Remote access instead.

The installer always installs the exact host-only `kaioken-app` package exposed by
that server at `/install/kaioken-app.tgz`. The package contains the host daemon,
provider/plugin workers, native host dependencies, and bundled `kaioken` CLI, but no
web app or server. A `kaioken-app` already on PATH is reused, and the npm registry
consulted, only when the server provides no package. Version strings cannot
distinguish unpublished builds, so the route also publishes a SHA-256 digest.
The installer verifies that digest and uses a conditional request on later runs
to skip an identical installed artifact. The package route is public like
`/install.sh`: `kaioken-app` is public software, and exposing an unpublished build
slightly early through a paired tunnel is an accepted tradeoff. npm installs
the package into the machine's kaioken data directory, not its system-wide global
prefix, so enrollment needs neither `sudo` nor a PATH change.

Each joined server gets its own daemon instance, data directory
(`~/.kaioken-machines/<server-host>`, override with `KAIOKEN_DATA_DIR` when running the
installer), local API port, and launchd/systemd service. The installer persists
the selected port in that data directory and atomically reserves it under
`~/.kaioken-machines/host-daemon-ports/`, including when `KAIOKEN_DATA_DIR` points
elsewhere. Subsequent runs reuse the reservation; pass `--host-daemon-port
<port>` to the installer to override the selection. One machine can therefore
serve several kaioken servers at once, and joining never touches a full local kaioken
install's `~/.kaioken`. Each instance keeps its own `kaioken-app` under that data
directory and self-updates against its own server, so servers running different
kaioken versions on one machine remain isolated.

The installed launchd/systemd service enables `--auto-update`. If session open
reports a newer server protocol, the daemon downloads the server artifact,
verifies its SHA-256 digest, updates its private install, then exits so the
service manager restarts it. If the identical artifact is already installed,
the server returns `304` and the daemon restarts without downloading or running
npm again.
Failed attempts fall back to normal reconnect behavior with a persisted
exponential retry backoff from 5 seconds to 5 minutes. Settings → Connections → Advanced: execution workers and
`kaioken machine retry-update <id-or-name>` can bypass the current backoff. A daemon
never downgrades itself to an older server protocol. To opt out, remove
`--auto-update` from
`~/Library/LaunchAgents/app.getbb.host-daemon.<server>.plist` or
`~/.config/systemd/user/kaioken-host-daemon-<server>.service`, then reload the
service.

After it connects:

1. To create a project from that machine, choose New project, select the
   machine, and browse to its folder. To map an existing project there instead,
   add its path or clone source in project settings.
2. Select the machine when creating a thread, or use `kaioken thread spawn --machine
<id-or-name> ...`.
3. Inspect enrolled machines with `kaioken machine list`.

Machine names are conveniences and may be duplicated; CLI targeting by name
requires an unambiguous match. IDs are always accepted. Removing a machine from
Settings stops kaioken from dispatching new work to it; revoke a lost machine's kaioken
connect access from the getbb.app dashboard as well.

Browser access and execution remain independent: opening kaioken on a laptop does
not enroll that laptop, and enrolling it as a machine does not expose the kaioken UI.
