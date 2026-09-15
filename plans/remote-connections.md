# Remote connections

## Accepted outcome

Connect to an existing Kaioken computer and use its projects, tasks, provider
sessions, plugins, files and terminals from the normal workspace. Opening a
remote task preserves its execution location. Keep worker enrollment available
as an advanced operation. Connection setup must distinguish access to this
computer, other Kaioken installations, and SSH hosts.

## Architecture

- A connection owns its server identity, authenticated HTTP and realtime
  transports, reachability state and cached workspace data.
- Every workspace target identifies its owning server, execution host and
  resource. Display handles and connection URLs are discovery metadata.
- Each server keeps its database and host-local credentials. The server keeps
  product policy; the daemon keeps execution primitives.
- A disconnected workspace preserves history and drafts. Failed writes remain
  failed and are never silently replayed or marked as delivered.
- The normal workspace is shared by local and remote tasks. Its query caches,
  plugin runtime and subscriptions must resolve against the same connection.
- SSH uses OpenSSH configuration and authenticated forwarding to an existing
  or bootstrapped remote Kaioken runtime.
- Handoff is an explicit operation that transfers a task and Git state into a
  matching destination project. Viewing a task never performs a handoff.

## Work and acceptance evidence

- [x] Shared connection transport, installation identity and lifecycle.
- [x] Full task and compose workspace with isolated persistent frames.
- [x] Connections settings, account computers and SSH discovery/attachment.
- [x] Explicit native Codex task handoff with Git state and recoverable progress.
- [x] SDK, CLI and discoverable documentation.
- [x] Targeted Turbo tests/typechecks, builds and isolated browser verification.
- [ ] Release QA on two independently paired physical computers: authenticated
      account/SSH handoff, reconnect, native browser/file/terminal panels, and
      the desktop computer menu. No physical remote was connected in this task.
- [ ] iOS Simulator Safari verification. Simulator is unavailable on this host;
      the responsive drawer was checked at 390 × 844 in the browser.

## Implementation progress

The full app is reused in a persistent frame for each connected origin. This
isolates plugin runtimes, storage and subscriptions without a second task UI.
The parent owns the sidebar, computer selection, identity checks and navigation.
Frame messages validate source, origin, nonce and server identity. HTTP and
realtime requests carry the expected installation identity; replacement servers
reject stale requests. Frames retain loaded history and drafts when hidden.

Connections settings, SSH discovery/attachment/reconnection, binary desktop HTTP,
authenticated desktop realtime, browser HTTP through known SSH tunnels, the
SDK connections area and CLI commands are implemented. Worker codes are generated
only on request. The desktop account menu now navigates in the local shell.

Verification includes real dev SSH discovery, wire response round trips,
consecutive SSH network failures, cancellation, desktop socket ownership,
binary HTTP and SSH bridging, identity mismatch rejection, and frame navigation.
A live browser preview verified the full compose workspace without a second
sidebar and draft retention while switching away/back. It used the isolated dev
installation, not a real remote computer; actual cross-computer native panels and
handoff still need end-to-end verification on independent computers.

User-requested polish is complete: Codex import moved from under the composer to
More, and title-row icons have centered 32px targets with 8px padding. Both were
verified in the browser; the import dialog still opens.

Computer identities are now pinned by saved computer handle as well as origin,
so changing an SSH tunnel port cannot silently change installations. A real
temporary HTTP server verified binary SSH requests/responses, credential
stripping, redirect rejection and unavailable-tunnel errors. SSH startup uses the
remote user's login shell.

Switching the compose project to a remote computer copies attachments and carries
the draft through an acknowledged frame message. It clears the source only after
receipt, preserves an existing remote draft separately, and does not overwrite
edits if navigation repeats. The transfer is bound to the destination server
identity. Browser verification confirmed the incoming draft and duplicate-message
behavior. Provider-specific mentions become plain text because their references
belong to the original computer. The preview also exposed and fixed a repeated
handshake on route changes. Composer/bridge checks pass, including the existing
plugin composer and root compose tests.

Git handoff primitives are implemented in `packages/host-workspace`: temporary
index snapshots preserve staged/unstaged changes separately, bundle transfer
verifies repository identity and project subdirectory, and restoration creates
an isolated worktree. Four real-Git tests cover source index preservation,
untracked/binary files, symlinks, ignored files, corrupt transfers, mismatched
repositories, existing paths/branches, unmerged indexes, and checkout-hook
rollback. Daemon transfer RPCs now export Git/native-session files, transfer them
in 1 MiB chunks, check digests, and restore a new worktree with a new native staging
session identity. Real-Git daemon tests verify isolated homes, repeated transfers,
and recovery of a partially written chunk.

The user explicitly selected native Codex session continuity for the first
handoff implementation. An isolated Codex app-server probe forked an imported
native session, preserved both conversation markers, and used the destination
working directory without transferring credentials.

Handoff now has a generated SQLite migration, durable source/controller/destination
records, a write guard while the source is paused, matching-project previews,
authenticated account/SSH orchestration, native provider fork without goal
continuation, separate conversation-attachment transfer, SDK and CLI surfaces,
and a shared responsive dialog opened from local/remote task menus. The destination
stays hidden until the native session is ready. Completion reveals it before
archiving the source; cancellation waits for the destination before releasing the
source. Coordinator tests verify a lost completion response, controller restart,
idempotency and cancellation while the destination is unavailable. Contract tests
and affected typechecks passed before the latest attachment/daemon test additions.

## Final verification and limits

Destination native-fork failure can be retried using the same restored workspace.
Missing worktree receipts recover only when the owned worktree still matches the
transfer; later user edits are preserved and cause a clear error. Cancellation
waits for an active chunk, confirms the destination has stopped, then unlocks the
source. A cancelled participant records a tombstone to reject late requests.
Semantic payload comparison makes reordered JSON safe to retry.

The destination selects its configured private or shared Codex session store.
Tests cover both stores with real Git and native session files. The dialog stores
an uncertain start before sending it, restores it after reload, and reuses the
original operation ID. Native provider readiness is verified before revealing the
destination and archiving the source. The CLI and SDK expose preview/start/status/
retry/cancel; the built CLI help and JSON flags were checked.

Passed evidence includes server lifecycle and existing Codex import tests (13),
daemon transfer/recovery tests (3), Git tests (5), host contract tests (55), plugin
API guide tests (74), dialog reload and existing native task actions (5), plus
previous connection, transport, draft, provider and composer checks described
above. Affected typechecks and the app/server/CLI/daemon/desktop builds pass.
The latest lazy workspace navigation tests and typecheck are recorded in
`.tempo/HANDOFF.md`.

Independent baseline verification at `1d18c1a67b` reproduced the existing SDK
`threadSections.create` fixture failure (missing `projectIds`), the provider-ID
ratchet failures (identical output), and the app boot-size budget failure.
The original boot is 1783.8 KiB raw / 433.8 KiB Brotli; this change after lazy loading
is 1794.1 / 436.6 KiB. The thread route closure stays below its budget. Budget limits
and unrelated failing fixtures were not changed.

Current limits: native Codex only; Git submodules and LFS are rejected; history
uses the existing 8 MiB event-response limit and fails instead of truncating.
Restored worktrees are attached environments, so environment setup/teardown hooks
are skipped. Transfer files and cancelled worktrees remain for recovery. SSH
requires an installed Kaioken runtime and pre-established OpenSSH trust. Account
pairing, actual SSH session establishment, independent computer handoff and native
panel parity require the release QA above. The local browser verifies the real
workspace UI and isolated test transport, not those physical-computer conditions.

## Research sources

Official references: [remote connections](https://learn.chatgpt.com/docs/remote-connections),
[remote access](https://learn.chatgpt.com/docs/remote), and
[app server](https://learn.chatgpt.com/docs/app-server).
Codex's private relay implementation is not public; Kaioken uses its own relay.
