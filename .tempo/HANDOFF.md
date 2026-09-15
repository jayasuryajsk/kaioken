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
