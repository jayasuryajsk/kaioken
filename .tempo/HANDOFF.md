# Current update — unified signed-in computers, 2026-09-17

User requested one shared workspace for signed-in computers and removal of pairing
codes from the normal UI, then explicitly authorized pushing this implementation
to GitHub. No desktop release is authorized for this change. The user's earlier
instruction to skip Daybreak remains in force; no external reviewer was used.

## Changes

- Remote tasks and project composers now render native views in the local app;
  the embedded RemoteWorkspaceDeck is removed. Legacy workspace bookmarks redirect
  to the corresponding native task or project route.
- Projects, tasks and search always combine connected computers, with namespaced
  IDs and machine labels. Account settings explain automatic discovery instead
  of requiring a separate Connect action.
- GitHub is the normal sign-in UI. Pairing and re-pair controls are removed;
  compatibility CLI/RPC pairing remains. Sign-out revokes this computer before
  clearing credentials, retaining them if revocation fails.
- Snapshot subscriptions are shared and reference-counted, with batched event
  refreshes and a five-minute recovery fallback. Native task history, replies,
  stop and approvals use the owning server. Older history can be loaded.
- Remote drafts and uploads are machine-scoped. Images and file attachments use
  the authenticated remote fetch bridge; changed installation identities block
  native actions until explicitly trusted.
- SDK/CLI targeting and the new workflow are documented in multiple-devices.md
  and the bundled guides. No server/daemon wire contract changed.

## Verification and remaining scope

Turbo app/Connect typechecks passed after final code changes. App focused tests:
50 native routing, compose, reply, approval, sidebar, account settings and fetch
checks passed; the additional remote-image test and 47 shared conversation tests
passed. Connect's full 95-test run passed, followed by 12 focused UI tests after
adding the sign-out revocation-failure case. Formatter and git diff checks pass.
Development desktop build passed (12 upstream build tasks plus Electron build).

Logs: /tmp/kaioken-unified-push-types.log,
/tmp/kaioken-unified-app-final.log, /tmp/kaioken-unified-attachment-tests.log,
/tmp/kaioken-unified-shared-timeline-tests.log,
/tmp/kaioken-unified-connect-tests.log,
/tmp/kaioken-unified-connect-ui-final.log and
/Users/macstudio/.kaioken-dev/launchers/kaioken/desktop.log.

Live visual verification was blocked by the Mac locking; the user interrupted
that step to request this push. Physical two-Mac verification is still pending.
The native remote task composer currently preserves its existing model and
permission settings; full remote plugin panels, file navigation and terminal
parity are outside this change. New remote tasks have model/provider selection.
Next: verify opening and replying to a task across the two Macs before a separately
authorized desktop release. Installed 1.0.21 remains unchanged.

---

# Previous update — desktop 1.0.21 published, 2026-09-17

User authorized push and desktop release. Main and desktop-v1.0.21 were pushed
at 3400707be; desktop-latest now serves 1.0.21. Release:
https://github.com/jayasuryajsk/kaioken/releases/tag/desktop-v1.0.21.

Used the established local macOS Apple Silicon release script. The production
build and packaged startup/desktop-bridge smoke passed. Public release assets
are uploaded; the downloaded update feed's version, archive URL, size and
SHA-512 match the local 147477708-byte zip. No Apple signing identity was
available, so this is the existing unsigned macOS release format. No Linux or
npm publication was requested or performed. The installed app was not replaced.

Logs: /tmp/kaioken-desktop-1.0.21-release.log and
/tmp/kaioken-desktop-1.0.21-smoke.log. Physical two-Mac login/remote-workspace
testing remains pending while MacBook is unavailable. The prior hold on a
desktop release was superseded by this explicit request.

---

# Previous update — live GitHub setup and sign-in, 2026-09-17

User authorized GitHub OAuth configuration, Cloudflare deployment and live
verification. The MacBook is unavailable, so physical two-Mac testing remains
pending. No Git push or desktop release was performed; the installed app was
not changed.

## Live configuration

- GitHub OAuth app Kaioken: https://github.com/settings/applications/3863677.
  Homepage https://kaioken.app; callback
  https://kaioken.app/auth/github/callback. Wildcard callback and device flow
  are disabled. Sign-in requested public-profile access only.
- Cloudflare kaioken-relay has GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET and
  GITHUB_ALLOWED_USER_ID configured as secrets. Owner is jayasuryajsk, numeric
  ID 13784001. Existing PAIR_CODE and SESSION_SECRET were retained. No secret
  values were written to source or this handoff.
- Relay migrations v3 AccountDO and v4 LoginDO deployed. Current live version:
  24bffd21-4a7d-4651-8957-6b1580fe510e. Existing wildcard/custom-domain routes,
  STATE KV and legacy devices were retained; no paid-plan change.
- Wrangler login uses encrypted local credential storage with a macOS Keychain
  key. Deployment logs: /tmp/kaioken-relay-live-deploy.log and
  /tmp/kaioken-relay-redirect-deploy.log.

## Fix and evidence

The real Chrome consent POST exposed a CSP issue: form-action 'self' blocked its
redirect to GitHub. Added only https://github.com/login/oauth/authorize to the
allowed form destinations, with a response-header regression assertion. Relay
tests (25) and typecheck passed through Turbo; log:
/tmp/kaioken-relay-oauth-redirect-tests.log. The corrected relay was redeployed.

Real GitHub authorization then completed successfully. The isolated Mac Studio
source runtime registered as mac-studio-source-434cb033, connected, and retained
the same authenticated connection after restart. Its Connections UI shows
jayasuryajsk. Source app: http://localhost:16606/settings/connections; Connect
relayUrl is https://kaioken.app. Data directory remains
/Users/macstudio/.kaioken-dev/kaioken-660257e6d19f. No model request was sent.

Live discovery returned the source runtime and legacy mac-studio/studio devices.
The legacy studio entry is named MacBook, but that does not verify fresh login
on the physical MacBook. Opening its workspace from the ordinary localhost
browser returned unavailable. This browser uses cross-origin cookie auth,
whereas the desktop uses its credential-bearing federated bridge; the browser
failure is not evidence that the desktop bridge works or that MacBook is offline.

## Remaining verification

When MacBook is available, use updated clients on both Macs to test fresh login,
opening remote repos/tasks, reconnect and revocation. Packaged deep-link
activation and desktop bridge access were not live-tested here. The deployed
relay and tested source runtime are ready; the installed desktop still needs an
updated build. Do not publish a desktop release without user authorization.

---

# Previous update — personal GitHub sign-in, 2026-09-17

Implemented the approved sign-in flow on top of live discovery. Scope is the
user's personal single-owner service. No GitHub OAuth application was created,
no credentials were configured, and no push, deployment or release was performed.

## Delivered

- Connections settings has Continue with GitHub, browser handoff, resumable
  waiting/cancel/error states, and account identity. Legacy code pairing is
  collapsed under an advanced option. Computers have inline rename and revoke.
- Relay LoginDO uses ten-minute transactions, state, S256 PKCE, browser-bound
  HttpOnly cookies, explicit computer consent and one configured numeric GitHub
  owner ID. GitHub tokens are used only to retrieve identity, never persisted.
  Missing configuration fails closed. Wrangler migration v4 adds LoginDO.
- Each runtime generates its device proof locally. The relay stores its hash,
  pushes approval through hibernating WebSockets, and registers the device under
  the personal account. Transactional registration receipts prevent duplicate
  devices after lost responses and preserve revocation during retries; receipts
  expire after eleven minutes. Cancellation removes an unaccepted registration.
- Pending sign-in survives restart; retries use bounded exponential backoff.
  New account credentials and pending proofs are atomic 0600 files under the
  runtime's plugins/connect/secrets directory. Desktop safeStorage and old KV
  pairing remain compatible. No proof is exposed through UI/CLI status or URLs.
- SDK plugin RPCs and CLI login/logout/rename/revoke cover the UI features.
  Logout confirms cloud revocation before clearing credentials. Legacy off
  remains best-effort. A credential-free kaioken://account/signed-in link focuses
  the packaged app. No host-daemon wire change was needed.
- CLI help, plugin skill, guide templates, configuration docs, multi-device guide,
  and relay setup/protocol docs describe the actual workflow and prerequisites.

## Verification

195 relevant tests passed: relay 25 (real Miniflare Durable Objects/KV with only
GitHub HTTP mocked), Connect plugin 103, Connect client 22, app interactions and
federation 8, desktop packaging/cache/discovery 37. All five affected package
TypeScript checks passed through Turbo. Later boundary changes were typechecked
and tested again in their affected packages.

Tests cover wrong owner, callback cookie/state/CSRF failures and replay, PKCE,
missing configuration, pushed approval, two-device registration, same-device
rotation, registration retries, revocation, cancellation/late completion,
restart recovery, transient failures, private file permissions, CLI/RPC paths,
UI actions/errors, existing pairing and discovery behavior.

Browser inspected the source app at http://localhost:16606/settings/connections.
The sign-in and advanced-pairing layout renders correctly. The actual unavailable
development relay exposed an unhelpful fetch error, which was replaced with clear
connection/old-relay messages and covered in client tests. The corrected
connection error was confirmed in the browser after reloading. The dev launcher is
running; the installed desktop was not relaunched or modified. No live GitHub,
physical two-Mac login, or packaged deep-link activation is claimed as tested.

Logs: /tmp/kaioken-login-all-types.log,
/tmp/kaioken-login-plugin-verified.log,
/tmp/kaioken-login-boundaries-verified.log,
/tmp/kaioken-login-app-tests.log,
/tmp/kaioken-login-desktop-tests.log,
/tmp/kaioken-login-desktop-cache-tests.log.

## Next action

Before a separately authorized rollout, create/configure the GitHub OAuth App
with callback https://kaioken.app/auth/github/callback and relay values
GITHUB_CLIENT_ID, GITHUB_CLIENT_SECRET, GITHUB_ALLOWED_USER_ID. Deploy the relay
v3/v4 migrations before updated clients, then verify MacBook/Mac Studio login,
discovery, reconnect and revocation. See apps/relay/README.md. The current local
Cloud development service does not implement GitHub login; a source client needs
its Connect relayUrl set to the configured relay for that flow.

---

# Previous update — live device discovery, 2026-09-17

Implemented the user's approved replacement for five-minute KV directory caching.
No push, Cloudflare deployment, desktop release, or paid plan change is authorized
by this work. Full account sign-in remains a separate pending feature; personal
relay pairing continues to use the existing codes.

## Delivered

- One personal AccountDO owns device metadata, credential lookup/revocation and
  one-time pairing codes. Wrangler migration v3 imports existing STATE KV records
  once, retaining the source as backup. All subsequent account operations use
  durable account storage; the old per-isolate cache is removed.
- Authenticated discovery WebSockets send complete snapshots on connect and on
  pairing, removal, and tunnel presence changes. Automatic ping/pong preserves
  hibernation. Failed broadcasts/presence/revocation notifications retry through
  durable alarms. No heartbeat scans KV or periodically writes last-seen state.
- Connect shares one subscription with local browser/desktop views through the
  existing realtime channel. Desktop-only operation can subscribe directly.
  CLI `kaioken connect servers` and the existing SDK RPC use that same cached
  snapshot. The UI's five-minute local refresh is only a fallback.
- Reconnect deadlines, jittered exponential backoff, silent disconnect detection,
  revocation messages/handshake rejection, disposal, and late-response guards
  protect recovery. The host daemon protocol is unchanged.

## Evidence and limits

152 relevant tests passed: relay 20 (real Miniflare KV/DO and Node WebSockets),
Connect client 20, Connect plugin 95, federation UI 6, desktop device sync 11.
All five affected package typechecks passed through Turbo. Tests cover live
pairing/presence/reconnect, atomic pairing-code consumption, legacy migration,
revocation, idle heartbeats, cache sharing, and late HTTP results.

Logs: `/tmp/kaioken-discovery-tests.log`,
`/tmp/kaioken-plugin-discovery-final.log`, `/tmp/kaioken-federation-tests.log`,
`/tmp/kaioken-desktop-discovery-tests.log`, `/tmp/kaioken-discovery-ui-types.log`,
and `/tmp/kaioken-desktop-discovery-types-final.log`.

The installed Miniflare version delays the client close event even after the
Durable Object reports CLOSED. A standalone minimal DO reproduced this without
Kaioken (`/tmp/kaioken-ws-close-probe.cjs`). Relay tests assert immediate revocation
notification and rejected credentials; client tests verify disposal and no retry
on that notification. Production close timing and two-Mac operation are not
claimed as verified. No service deployment was used for verification.

## Next action

Review the local implementation. When the user authorizes rollout, deploy the
relay migration before updated clients and verify MacBook/Mac Studio behavior
and Cloudflare usage. Older clients retain the HTTP directory route. See
`apps/relay/README.md` for migration/rollback details: after accepting mutations,
the retained KV copy is stale, so do not roll back to a KV-only worker without
reconciling current durable state. Remote project/task polling remains unchanged.

---

# Remote connections — implementation handoff

Date: 2026-09-15
Branch: `codex/remote-connections`
Base: `1d18c1a67b` (desktop 1.0.16)

## Delivered

The user approved native Codex continuity first. Full remote workspaces now stay
inside one local shell with independent frame runtimes, installation UUID checks,
authenticated desktop HTTP/WebSockets, connection recovery, and retained drafts.
Settings groups account computers, SSH connections and advanced execution workers.
SSH reads OpenSSH aliases and starts or attaches to an installed remote runtime.

Task menus expose **Move to computer**. Handoff stops the source, transfers native
Codex history, conversation attachments and staged/unstaged Git changes, restores
a matching destination project in a new worktree, and forks the native session.
The destination uses its own credentials and configured session store. It becomes
visible before the source is archived. Durable records, checksums, chunk receipts,
retries and cancellation protect recovery. An uncertain UI start survives reload.
SDK/CLI and Plugin Guide surfaces are included. Daemon protocol is 201; migration
0118 is generated. The two browser comments are fixed: import is in More and the
search/bell hover targets are padded 32px squares.

Details and research: [remote-connections.md](../plans/remote-connections.md).
Usage: [multiple-devices.md](../docs/multiple-devices.md).

## Verification

- Affected app/server/daemon/SDK/contract/API-map typechecks passed (10 Turbo tasks).
  Desktop/CLI/plugin-SDK typechecks also passed before the final UI-only split.
- Full desktop dependency build passed, including app/server/daemon/CLI/runtime.
  Final app code splitting was built separately and UI/typechecked afterward.
- Server handoff lifecycle + existing native import: 13 tests passed.
- Real-Git native transfer/recovery: 3 daemon tests, private and shared stores.
- Git snapshot/restore: 5 tests. Source index, staged/working contents, binary,
  symlinks, untracked/ignored files, failure rollback and unsupported repos checked.
- Host contract: 55 tests. Plugin API guide: 74 tests. CLI JSON flags: passed.
- Latest workspace protocol/frame/dialog checks: 6 tests. Dialog reload recovery
  and existing Codex task actions: 5 tests.
- Earlier transport, identity, SSH, attachment, draft/composer and native provider
  checks passed; see the plan. A real isolated Codex 0.154.0 app-server fork probe
  preserved native conversation markers without a model call or copied credentials.
- Browser: full compose and draft retention, import placement, icon padding,
  Connections settings, task-menu dialog and 390×844 drawer. No horizontal overflow
  or inert/aria-hidden app root. No real user task was moved or stopped.

Logs are under `/private/tmp/kaioken-*`, particularly
`kaioken-connections-verified-typecheck.log`,
`kaioken-handoff-server-verified.log`,
`kaioken-handoff-daemon-homes-tests.log`,
`kaioken-connections-lazy-ui-tests.log`, and
`kaioken-connections-build.log`.

## Existing baseline failures

An isolated archive of the base commit with its own workspace dependency links
reproduced these failures; do not attribute them to this change:

- SDK `threadSections.create` fixture omits required `projectIds` (same failure;
  103 other SDK tests pass on the feature branch).
- Provider-reference ratchet output is identical to the base.
- Boot-size budget already fails: base 1783.8 KiB raw / 433.8 KiB Brotli;
  feature after lazy loading 1794.1 / 436.6 KiB. Thread route stays within budget.
  No budget was raised. Baseline logs: `kaioken-connections-baseline-*.log`.

## Release QA and current limits

The dev installation is not paired and no physical SSH/account computer was
connected. Verify handoff/reconnect/native panels and the native computer menu
between two independently paired installations before release. iOS Simulator is
unavailable; compact browser verification is not an iOS Safari claim.

Handoff supports native Codex only. Submodules and Git LFS fail explicitly.
History retains the existing 8 MiB response limit and never truncates silently.
Restored worktrees are attached environments and skip lifecycle setup/teardown
hooks. Transfer files and cancelled worktrees are retained for recovery.
SSH needs Kaioken installed and existing host trust; it does not install software.

## September 16 pre-push review corrections

Daybreak Blue at high reviewed `1d18c1a67b..8519fe2df` and returned five findings.
The review is retained at `/private/tmp/kaioken-daybreak-push-review.md`.

- Source mutations now reject throughout public task routes; asynchronous edits
  and context clearing hold a mutation guard so a snapshot cannot start midway.
  Queue creation and cascading archive paths also enforce the handoff guard.
- Remote frames obtain a scoped native browser API after the verified handshake.
  The parent validates origin/source/nonce/server UUID, namespaces tab IDs,
  clips/translates bounds, filters events, and hides inactive workspace views.
  Agent-owned browser targets remain bound to their original desktop; browser
  credentials and automation sessions are not transferred.
- Account registration already uses DNS-safe handles; account discovery now
  validates that same character set and cannot collide with `ssh.<alias>`.
- Plugin contribution/search, clipboard images, and SSH proxy requests use the
  identity-aware fetch path. External image requests do not receive identity.
- Attachment reads use bounded ranges. Destination restore verifies the full
  checksum before making transferred attachments available.

Verification: 50 targeted server tests, 17 UI tests, eight remote-fetch tests,
seven Turbo typecheck tasks and six build tasks passed. Test compatibility fixes
and final bridge changes received focused reruns. Logs use the prefix
`/private/tmp/kaioken-push-fixes-`. Independent physical-computer native QA
remains outstanding. The corrected committed range must pass the final Daybreak
gate before the requested push.

## Development runtime

Development UI: `http://localhost:16606/settings/connections`.
Server: `http://localhost:24606`; daemon: `http://127.0.0.1:32606`.
Dev data is isolated under `~/.kaioken-dev/kaioken-660257e6d19f`.
Production data and user tasks were not changed. No push or deployment performed.

Next action: pair two test installations, then exercise the documented account/SSH
handoff flow and native panels with a disposable task and Git fixture.
