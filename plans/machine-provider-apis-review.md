# Review: bb/machine-provider-apis (PR #3274)

Scope: working tree (committed + uncommitted) against the merge base with origin/main (`47d46b4147`). 454 files, +38k/-2.3k. The ui-preferences subsystem and the ProjectSettingsView deletion come from main and are excluded.

Decisions applied (from the interview):
- Requirements kept: suspend/resume, snapshot-on-pause, plugin-owned idle timing, custom Dockerfile/images, Modal image-build and sandbox-debug CLI, machine provider `inputs` + `validate`, the thread/terminal activity events, machine environment variables.
- May propose removing: unused bootstrap SDK members.
- Server access: keep the plugin API, make core generic (no hardcoded `connect`).
- Manual provider: fold into core.
- Plan docs and the PR3274 summary were not used as evidence of intent.

Typecheck on the working tree passes (`turbo run typecheck`, 11 tasks).

Line numbers refer to the current working tree.

---

## P1. Bugs

### 1.1 Modal drops checkpoint promises during snapshot cleanup
`plugins/environment-modal-sandbox/server.ts:353`, `:373`

`deletePendingSnapshots` types its callback as `(resource) => void` and calls `checkpoint?.(current)` without awaiting. `context.checkpoint` is now `Promise<void>` (the uncommitted diff made it async). Every checkpoint inside the pending-snapshot loop is fire-and-forget: a rejected checkpoint (lease replaced, host no longer owned) is an unhandled rejection, and the next iteration proceeds to delete the next snapshot image after core has refused to record that the previous one is gone. Fix: type the callback as `Promise<void>` and `await` it.

### 1.2 Machine-inputs code in the composer cannot reach the server
`apps/app/src/components/promptbox/NewThreadComposer.tsx:554`, `:1041-1150`; `apps/server/src/services/threads/thread-environment-placement.ts:526`

For a composed environment the composer resolves `machine: null` (line 554), so `selectedMachineProvider` is undefined and the ~110 lines of machine-provider-inputs state, slot mounting, and blocker text never activate. On the server, a composition refuses any `machine` in the request and always substitutes `inputs: null`. So a machine provider that declares `inputs` can be created from the Add-machine dialog but can never be launched from the composer with inputs. Since inputs stay a requirement: either compositions must accept machine inputs (server passes them through, composer collects them) or the composer code should be deleted and the limitation documented. Today it is dead code that looks live.

### 1.3 Connect grant credential in plugin KV: withdrawn
`plugins/connect/src/server-access.ts:140`

Withdrawn after checking main: the connect plugin already keeps its pairing credential in plugin KV (`plugins/connect/src/credential.ts`), and that credential is strictly more powerful than the per-machine grant derived from it. Storing the grant beside it adds no exposure. No action.

### 1.4 Modal `resume` re-checks host identity that core already fences
`plugins/environment-modal-sandbox/server.ts:565`

Not a bug in itself, but the check exists because `bootstrap()` returns a `hostId` the plugin cannot trust. See 2.3: once create/resume stop returning `hostId`, this check and the matching one in core (`provider-orchestration.ts:268`) go away.

---

## P2. Design (public API and core/plugin boundary)

### 2.1 Modal reimplements daemon shutdown and disconnect-wait that core owns
`plugins/environment-modal-sandbox/server.ts:197-215`, `:463-485`

Suspend shells into the sandbox to find a `bb` binary and run `bb machine stop`, then polls `bb.sdk.hosts.list()` every 3 s for up to 4 minutes waiting for `status !== "connected"`. Core owns the daemon session; it can close it and knows synchronously when it is gone. Core's `suspendMachine` should stop the daemon (or ask the daemon to exit over the existing session) and only then call `provider.suspend`. That deletes `waitForHostDisconnection`, the shell snippet, `DAEMON_STOP_TIMEOUT_MS`, `HOST_POLL_INTERVAL_MS`, and the `bb machine stop` dependency inside the image. Every future provider would otherwise copy this.

### 2.2 Modal keeps a second allocation record because `reconcileCleanup` cannot see the checkpoint
`plugins/environment-modal-sandbox/server.ts:237-267`, `:399-437`; `packages/plugin-sdk/src/machine-provider.ts:100`

The plugin writes `allocation/<key>` to KV before and after `checkpoint()` so that `reconcileCleanup({ key })` can find the sandbox. Core already persists the checkpointed resource on the launch row and passes it to `remove`. Give `reconcileCleanup` the last checkpointed resource (`resource: JsonValue | null`) and the KV intent record, the account-identity pin re-check, and the `allocationSchema` all go. If the concern is "allocation may have happened before the first checkpoint", that is exactly what `key` plus the provider's `fromName(appName, key)` lookup already covers.

### 2.3 `create` and `resume` return a `hostId` core already knows
`packages/plugin-sdk/src/machine-provider.ts:42`; `apps/server/src/services/machines/provider-orchestration.ts:268-280`; `plugins/environment-modal-sandbox/server.ts:565`

Core reserves the host id when the provider calls `enrollments.prepare({ key })` and stores it on the launch. `invokeCreate` then verifies the returned id equals the reserved one and throws otherwise. The field exists only to be validated. Make `create` return `{ status: "created"; resource }`, have core use the reserved id, and treat "created without a prepared enrollment" as the error it already is. Same for `bootstrap()`'s return value.

### 2.4 Three checkpoint contexts with identical shape
`packages/plugin-sdk/src/machine-provider.ts:28-37`, `:59-66`

`PluginMachineProviderCreateContext`, `SuspendContext`, and `ResumeContext` each declare `checkpoint(resource): Promise<void>` with only the JSDoc differing. One `PluginMachineProviderLifecycleContext` with `checkpoint` on it (and `create` context extending it plus `key`/`attempt`/`inputs`) is the same API with two fewer exported names.

### 2.5 `target` prop: meaning changed, so the rename is defensible
`packages/plugin-sdk/src/app-contract.ts:1415`; `plugins/environment-project-checkout/app.tsx:449`; `NewThreadComposer.tsx:1022-1026`

On main `hostId: null` meant "no machine picked yet" and the checkout control rendered disabled. On the branch the slot is only mounted once a provider selection resolves, so the null case is unreachable and the only host-less case is a composition that will create a machine. `new-host` names that state honestly, which a nullable string would not. Keep the union as it is. The only ask is to note the breaking rename in the SDK bump.

### 2.6 Core hardcodes `connect` in eight places behind a generic provider API
`apps/server/src/services/machines/server-access.ts:97`, `:212-217`; `apps/app/src/components/settings/MachineAccessSettings.tsx:50`, `:194-207`, `:233`, `:278`, `:287`; `apps/app/src/components/machines/machine-server-access.ts:16`

Per your decision, make it generic:
- `ServerAccessProviderDeclaration` gains `description: string` (picker copy) and the settings link is derived from the registering `pluginId`, which core already has on the record.
- `serverAccessStatus` returns `pluginId` per provider; the UI stops injecting a fake `connect` option and stops branching on id.
- Default provider: first registered provider, else `direct`; no `?? "connect"`.
- `release()`'s fallback for legacy hosts (`machineProviderId === "manual" && connectMachineId !== null → "connect"`) belongs in the 0116 migration backfill (`server_access_provider_id = 'connect'` where `connect_machine_id IS NOT NULL`), not in runtime code.

### 2.7 Manual provider: fold into core (six special cases go away)
`apps/server/src/services/machines/enrollments.ts:507`, `:524`; `apps/server/src/routes/plugins.ts:791`; `apps/cli/src/commands/machine.ts:199-232`, `:443`; `apps/app/src/components/settings/MachinesSettingsSection.tsx:486-495`; `apps/app/src/views/MachineSettingsView.tsx:631`; `plugins/machine-manual/*` (server 64 lines, app 130, enrollment-command 150, rpc, README, tests 309 lines)

Core already owns the enrollment bundle, the `/install.sh` credential exchange, `manual-enrollment-command.ts`, and the uninstall command. The plugin adds an in-memory `pending` map (lost on restart, so the command silently disappears until regenerated), an RPC that core has to auth-gate by plugin id, a polling UI, and the `experimental_machineSetup` slot whose only registrant it is. Proposed shape:
- Core registers the `manual` provider itself (same `create`: prepare → checkpoint → waitForConnection).
- `GET /hosts/launches/:id` returns `command: string | null` for manual launches, built from the sealed bundle core already stores. That is the one thing the plugin RPC does.
- `CreateMachineDialog` renders a "Run this command" panel when `command !== null`. `bb machine create` prints it.
- Delete `experimental_machineSetup`, `ExperimentalMachineSetupProps`, the `client.hosts: Pick<HostsArea, …>` prop shape, the collector entry, the RPC auth exception, the uninstall-hint copies (keep one, in the launch/teardown message).

### 2.8 Two overlapping persisted state machines for suspend
`packages/db/src/schema.ts:1209-1218`; `apps/server/src/services/machines/lifecycle.ts:24-40`, `:96-286`

`hosts.phase` (active/suspending/suspended/removing/destroyed) plus `hosts.teardown*` already describe where a machine is. `machine_lifecycles` adds `recoveryState` (healthy/draining/saving/saved/recoverable), a heartbeat lease (`leaseId`, `leaseUntil`, 8 s interval), `retryAt`, and `message`. The lease guards against a second concurrent drain, but the server is a single process and `suspendOperations` (an in-memory map keyed by db) already provides that exclusion; the sweep clears stale leases on restart anyway. `draining`/`saving` are sub-phases of `suspending`; `recoverable` is `teardownStatus: "failed"` for a suspend. Proposal: fold `message`/`retryAt` into `hosts` (`suspendMessage`, `suspendRetryAt`) or reuse `teardownMessage`, drop the lease and the table, and derive the notice from `phase` + message. `waitForMachineMaintenance` becomes "await the in-flight suspend operation". Net deletion is roughly 150 lines plus the table, the FK, the `experimental_lifecycle` route/SDK method/CLI command and `MachineLifecycleNotice` polling every 10 s, which exist only to surface `recoveryState`. Nothing user-visible is lost: the notice already renders the stored sentence, and no client branches on draining versus saving.

### 2.9 `experimental_ServerAccessRecoveryError` is a string protocol on `Error.name`
`packages/plugin-sdk/src/backend-contract.ts:461`; `apps/server/src/services/plugins/plugin-service.ts:1655`; `plugins/connect/src/server-access.ts:29-33`

The contract is "throw an Error whose `.name` is this literal". It cannot be typed, discovered, or linted. `acquire` should return a result: `ServerAccessGrant | { status: "failed"; message: string }` with the message treated as user-safe by construction, and ordinary throws redacted as today. Same shape as `PluginMachineProviderCreateResult`.

### 2.10 Composition registration is an inline object union with `never` fields
`packages/plugin-sdk/src/backend-contract.ts:408-419`

`experimental_environments.register` accepts either a full provider declaration or `{ id, displayName, icon?, machineProviderId, environmentProviderId, create?: never, remove?: never }`. The `never` members exist to make the union discriminate. Either a named `PluginEnvironmentCompositionDeclaration` with its own `register` method (`experimental_environments.compose(...)`) or a `kind: "composition"` discriminator. Also `icon` is optional here but required on machine providers; the route falls back to the machine provider's icon, so drop `icon` from the composition entirely.

### 2.11 Activity events: implementation notes (events stay per your call)
`plugins/environment-modal-sandbox/server.ts:148-190`; `apps/server/src/services/plugins/plugin-service.ts:1549-1561`

Kept as a requirement. Two things worth tightening:
- The handler for `experimental_thread.events` does a `bb.sdk.environments.get` per event to map thread → host. `ThreadResponse` already carries `environmentId`; if the DTO also carried `hostId` (it is one join on the server) the plugin drops a round trip per debounced event.
- The cron scans `bb.sdk.hosts.list()` every minute and reads one KV key per Modal host. Fine at current scale; note it if hosts grow.

### 2.12 Machine provider `inputs`: implementation notes (kept per your call)
`packages/plugin-sdk/src/internal/host-policy.ts:2440-2587`; `apps/server/src/services/machines/provider-availability.ts:29-58`; `apps/server/src/routes/system.ts:512-528`

Kept as a requirement. Issues:
- `machineProviderAcceptsEmptyInputs` invokes the plugin's schema with `{}` on first listing and caches by provider object. It exists so the UI can decide whether to show a control. The provider could declare that directly (`inputs: { schema, optional: true }`) and skip the probe.
- `PluginMachineValidateDecision` lives in `backend-contract.ts:429` while every other machine type lives in `machine-provider.ts`, which imports it back through the package root. Move it.
- `PluginMachineProviderDeclaration` (`backend-contract.ts:433`) is a pure alias of `PluginMachineProviderDefinition`. One name.
- See 1.2 for the composer path.

### 2.13 Unused bootstrap members (removal approved)
`packages/plugin-sdk/src/machine-bootstrap.ts:60`, `:72`; `apps/server/src/services/machines/bootstrap.ts:31`; `apps/server/src/services/machines/enrollments.ts:443-497`, `:589-608`; `apps/server/src/services/machines/provider-orchestration.ts:314`; `packages/plugin-sdk/src/machine-provider.ts:49`

- `installerCommand(bootstrap)` on the SDK: only core's own `bootstrap()` calls it. Make it a module-private function.
- `enrollments.cancel` and `cancelByKey`: no plugin calls them; `cancelByKey` is referenced only by a test. Core already settles enrollments via `settleMachineEnrollments`. Delete both (~70 lines) and the fake-plugin-host stubs.
- `daemon: { kind: "preinstalled" }` and `preinstalledScript`: no caller. Modal uses `install`. Delete the discriminator; `bootstrap()` takes `executor` only.
- `allocation: "none"` on a failed create result: no provider returns it. Delete the field and the branch at `:314`.
- `MachineEnrollment` (pending) repeats `expiresAt` at the top level and inside `bootstrap`. Keep one.

---

## P3. Intra-branch leftovers (drift)

### 3.1 Bootstrap bundle "v1" format exists only to migrate from an earlier commit of this branch
`apps/server/src/services/machines/enrollments.ts:100-124`, `:325-355`; `apps/cli/src/commands/machine-enrollment.ts:40-56`, `:309-349`; `apps/server/src/assets/install-machine.sh:448-476`; `packages/plugin-sdk/src/machine-bootstrap.ts:8` (`version: 2`); tests in `apps/server/test/app/install-machine-script.test.ts` (1,350 lines, parameterised over v1/v2), `apps/cli/src/commands/machine-enrollment.test.ts:144-215`, `apps/server/test/services/machines/manual-provider.test.ts:139`, `:227`

Version 1 carried `client: { kind: "direct" } | { kind: "connect", machineCode, expiresAt }` and the machine redeemed the code itself; version 2 carries `headers`. Main never shipped v1; no enrolled machine holds a v1 bundle. The upgrade path (server re-seals v1 as v2 on prepare; CLI redeems the machine code and rewrites the file; the installer does the same in shell-embedded JS) is dead on arrival. Delete v1 everywhere, drop the `version` literal (a single shape needs no version until a second one exists), and delete the v1 test matrices. Rough net deletion: 250+ lines of source, several hundred of tests.

Also `docs/api_to_audit.md:2669` still documents the v1→v2 upgrade.

### 3.2 Modal resource schema carries nullables and a version for formats that never shipped
`plugins/environment-modal-sandbox/lifecycle.ts:3-15`; `plugins/environment-modal-sandbox/server.ts:104`, `:345`, `:544` (`resource.appName ?? …`), `:333-338`, `:356-361` (`accountIdentity !== null &&`)

`version: z.literal(5)`, nullable `imageId`, `accountIdentity`, `appName`, `cpu`, `memoryMiB`, and `snapshotSandboxId` with a default all accommodate resources written by versions 1–4 of this branch. Make them required, drop `version`, and delete the three `?? resolved.appName` fallbacks and the two `!== null &&` guards.

### 3.3 Modal parses an empty inputs schema it no longer declares
`plugins/environment-modal-sandbox/server.ts:228`, `:605`

`machineInputsSchema = z.object({}).strict()` and `machineInputsSchema.parse(context.inputs ?? {})` are left over from when Modal took inputs. The provider declares no `inputs`, so core guarantees `context.inputs === null`. Delete both.

### 3.4 Stale null checks on now-required `description` and `icon`
`apps/app/src/components/dialogs/CreateMachineDialog.tsx:364`, `:379`; `apps/server/src/services/plugins/plugin-api.ts:1658`

`SystemMachineProvider.description` and `icon` are required strings after the uncommitted change; `provider.description !== null`, `description === null ? null :`, and `provider.icon === null ? null :` are dead branches.

### 3.5 `EnvironmentMenuItem` extracts `content` and `itemClassName` for a single render site
`apps/app/src/components/pickers/EnvironmentPicker.tsx:683-737`

Leftover from the removed "Set it up in plugin settings" link rows that needed a second element type. Inline them back.

### 3.6 Legacy environment-retirement copy in machine docs
`plugins/bb-guide/skills/bb-plugin-authoring/references/backend-machines.md:111`; `plugins/machine-manual/README.md:14`; `plugins/bb-guide/skills/bb-plugin-authoring/references/backend-api-index.md:305` (`PluginMachineProviderEnvironmentRow` no longer exists)

### 3.7 `CreateMachineContent` receives an `open` prop it never reads
`apps/app/src/components/dialogs/CreateMachineDialog.tsx:61-67`

---

## P4. Simplification and duplication

### 4.1 Two AES-GCM seal/open implementations and three `serialized()` helpers
`apps/server/src/services/machines/enrollments.ts:68-124`, `:130-141`; `apps/server/src/services/machines/environment-storage.ts:26-38`, `:49-110`; `plugins/connect/src/server-access.ts:59-66`

Enrollments and machine environment each own a `readOrCreateSecretFile` + `createCipheriv("aes-256-gcm")` pair with the same IV/tag layout, each with its own key file. One `sealJson`/`openJson` in `@bb/secret-storage` taking a key file name serves both. The keyed promise-chain lock appears three times; `@bb/process-utils` or a tiny shared helper.

### 4.2 `listPublicHosts` encodes "still being created" as a four-way predicate
`packages/db/src/data/hosts.ts:169-207`

A host is public if (access provider set, no grant, has teardown message) OR ((seen OR no enrollment row) AND no non-ready launch). This reconstructs a state that `hosts.phase` could carry: insert hosts during `prepare` with `phase: "creating"` and flip to `active` on success; the query becomes `phase != 'creating' AND destroyed_at IS NULL`, and the access-failure case is `teardown_message IS NOT NULL` on a creating host, which the UI already renders.

### 4.3 Ownership predicate written four ways
`apps/server/src/services/machines/provider-orchestration.ts:904-921` (`lifecycleOwns`), `:1355-1360`, `:1387-1391`, and the checkpoint closures at `:975-990`, `:1188-1196`

`removeMachine` repeats the `machineOperationId`/`machineProviderId`/`phase`/`pluginId` check inline twice instead of calling `lifecycleOwns`. Pass the phase list and use the helper.

### 4.4 Boolean-flag parameters on `cancelMachineLaunch`
`apps/server/src/services/machines/provider-orchestration.ts:695-700`

`preserveFailure = false, forceRetry = false` is called four ways across the file and `routes/hosts.ts:137`. An options object with named intent (`{ reason: "terminal-failure" | "user" | "sweep" }`) reads at the call sites.

### 4.5 `requestMachineResume` waits for maintenance twice
`apps/server/src/services/machines/provider-orchestration.ts:1088`, `:1101`

### 4.6 Remove-machine dialog duplicated between list and detail views
`apps/app/src/components/settings/MachinesSettingsSection.tsx:470-520`; `apps/app/src/views/MachineSettingsView.tsx:618-660`

Same title, same description branches on `machineProviderId`, same error rendering, same button. Also the suspend/resume/retry-cleanup button trio. One `MachineRemoveDialog` and one `MachineLifecycleActions`.

### 4.7 `bb machine lifecycle --remove` duplicates `bb machine remove`
`apps/cli/src/commands/machine.ts:293-331`

The `--remove` path calls the same `sdk.hosts.delete` as `remove`. Drop it; `lifecycle` (if it survives 2.8) only reads.

### 4.8 Modal plugin glue
`plugins/environment-modal-sandbox/account.ts:44-60`, `:97-240`; `server.ts:126`

`registerAccount` registers every RPC and the whole CLI, not the account; `imageDefinition(bb)` is constructed three times (server, account, debug-sandbox); the CLI is a hand-rolled argv matcher (~150 lines) for nine subcommands. Rename to `registerRpcAndCli`, construct `imageDefinition` once and pass it, and consider a table of `{ path: ["image","build"], arity, run }` instead of the if-chain.

### 4.9 `report.log(JSON.stringify({...}))` for the snapshot timing
`plugins/environment-modal-sandbox/server.ts:490-496`

Logged text is shown to users as machine progress. Either a sentence or nothing.

### 4.10 Contract and route nits
- `packages/server-contract/src/api/hosts.ts:61`: `MachineLaunchStatus` is a plain interface in a file where everything else is a zod schema; the SDK cannot validate it.
- `packages/server-contract/src/api/hosts.ts:141`: `experimental_hostLifecycleResponse.phase` is `z.string()`; it is the host phase enum.
- `apps/server/src/routes/hosts.ts:340`: `POST /hosts/:id/lifecycle` with an empty strict body is a read; it should be `GET`.
- `apps/app/src/components/machines/MachineLifecycleNotice.tsx:19`: ad-hoc query key `["machine-lifecycle", hostId]` outside `query-keys.ts`.
- `packages/plugin-sdk/src/index.ts:23` re-exports bootstrap types from the package root while provider types live under `./machine-provider`. Put both under the subpath or both at the root.
- `ServerAccessProviderDeclaration.availability` (`backend-contract.ts:452-460`) spells `PluginMachineProviderAvailability & { serverUrl?: string }` twice; name it once.
- `experimental_hostLifecycleRequestSchema` is `z.object({}).strict()`; if the route becomes GET it disappears.

---

## Second pass (host-daemon, machine-auth, online-rpc, host-environment, agent-runtime, plugin-runtime)

### 5.1 Plugin-host worker swaps `process.env` per call with a waiter queue
`apps/host-daemon/src/plugin-host-worker.ts:6-42`, `:539`, `:597`

`createOperationEnvironmentScope` mutates the worker's `process.env` for the duration of each call and serialises calls whose env sets differ. The env is computed server-side from host + project, and no contributor reads `projectId` (`host-environment.ts:19-21`), so every call on a host carries the same set. Apply it once when the worker starts (or when the server's contributed env changes) and delete the scope, the waiters, and the per-call `envVars` field on the worker protocol.

### 5.2 `resolveHostEnvironment` is scaffolding around one contributor and reads a file per call
`apps/server/src/services/hosts/host-environment.ts:14-21`, `:31-38`

A `contributors` array with one entry, a context type carrying an unused `projectId`, and a synchronous `readFileSync` of the local host-id file on every RPC (terminal open, hook run, clone, plugin call) to decide "is this the local host". Call `resolveGitCredentials()` directly, take the local host id from deps (it is already known at startup), and rename `mergeHostAndProviderEnvironment`: its second argument is the user's variables, not a provider's.

### 5.3 Four copies of the keyed promise lock, three of the JSON redaction walker
`apps/server/src/services/machine-auth.ts:171-184` (`forHost`), plus the three in 4.1; `packages/agent-runtime/src/thread-event-redaction.ts:5-33` (`redactJson` and `redactOpaque` are the same function with different input types), `apps/host-daemon/src/operation-environment.ts:50-66` (`redactOperationContent`)

One `serializeByKey` and one `redactJsonStrings(value, redact)` in `@bb/process-utils`.

### 5.4 Thread-status check inside the generic RPC transport
`apps/server/src/services/hosts/online-rpc.ts:128-143`

`callHostOnlineRpcWithRetry` inspects `args.command.type` for `thread.start`/`turn.submit` and reads the thread row to refuse dispatch after a maintenance interruption. That is thread-dispatch policy living in the host transport layer; `dispatch-attempt.ts` already has the `isMachineWaitingForExecution` gate and is where this belongs. Also `callHostRetryableOnlineRpcWithoutAdmission` (`:95-98`) has a `phase !== "active"` guard that its non-retryable sibling lacks; either both or neither.

### 5.5 Stale `icon === null` in plugin-runtime
`apps/server/src/services/plugins/plugin-runtime.ts` (`listPluginMachineProviders`)

Same as 3.4: `provider.icon` is a required string now.

### 5.6 Machine-provider uniqueness enforced three times
`apps/server/src/services/plugins/plugin-api.ts:1660-1666` (`isMachineProviderIdTaken` at register), `plugin-runtime.ts` (`seen` set with a warning in `listPluginMachineProviders`), and the `isMachineProviderIdTaken` closure itself

Registration already refuses a taken id, so the list-time dedupe can never trigger. Keep the registration check.

### 5.7 Machine environment nits
- `apps/app/src/components/settings/MachineEnvironmentSettings.tsx:22`: another ad-hoc query key outside `query-keys.ts`.
- Same file, `save`: one PUT per row and one DELETE per removed row, sequentially; a single `PUT /system/machine-environment` with the full list would replace the loop and the partial-failure state it creates.

### Second pass: reviewed and fine
- `machine-auth.ts`: legacy `hostType` metadata schema is needed for keys issued on main; the `forHost` lock fixes a real enroll/revoke race.
- `host-lifecycle.ts`: resume-on-demand before admitting work is the right place.
- Host-daemon `enroll.ts`, `machine-auth-proxy.ts`: the `serverHeaders` generalisation replaces a connect-specific header cleanly.
- Redaction of contributed secrets across terminal output, hook output, clone errors, plugin-host stderr/results, and agent thread events is consistent; only the helper duplication in 5.3 is worth touching.
- `thread-archive.ts` cancels the thread's machine launch and sweeps the host; `thread-runtime-config.ts` merges host and provider env with provider precedence.

## Kept as-is after review

- Provider orchestration launch/cancel/sweep state machine (`provider-orchestration.ts`): dense but coherent; retries, cancellation, and replacement keys are exercised by tests. No correctness issues found beyond 2.3 and 4.3–4.5.
- Migration 0116 is a single squashed machine migration; the temp-table trick in `migrate.ts` is justified because main's `hosts.type` had only one value and cannot identify the local host.
- `HOST_DAEMON_PROTOCOL_VERSION` bumped to 197; legacy `auth.json` with `hostType` still parses on the daemon side.
- Environment hook idempotency table (`environment_hook_operations`) and `project-source-setup.ts` are needed for core-owned clones on new machines.
- `experimental_ownsPath` has a real consumer (project-checkout `ownsPath` result).
- `getResource` has a real consumer (Modal inspect).

## Suggested order of work

1. 3.1 (v1 bundle) and 3.2/3.3 (Modal leftovers): pure deletion, no design risk.
2. 2.13 (unused bootstrap members), 3.4, 3.5, 3.7, 4.x nits.
3. 2.3 + 2.4 (SDK shape) before any external plugin depends on `hostId`/three contexts.
4. 2.7 (manual into core) and 2.6 (generic server access): both delete special cases and the `experimental_machineSetup` slot.
5. 2.1 + 2.2 (core owns daemon stop; `reconcileCleanup` sees the checkpoint): shrinks Modal by ~120 lines and every future provider by the same.
6. 2.8 (fold `machine_lifecycles` into `hosts`) and 4.2: schema changes, do together since 0116 is unreleased.
7. 1.3: decide where the connect credential lives.

---

## Line budget (critical pass, no split)

Net lines vs merge base, excluding generated snapshot JSON and docs: source +12.5k, tests +14.3k, stories/fixtures +1.3k. Targets below assume the agreed follow-ups (2.1, 2.2, 2.4, 2.6, 2.7) plus the extra cuts named here. Numbers are estimates from reading, not measurements.

| File | Now | Target | How |
|---|---|---|---|
| `apps/server/src/services/machines/provider-orchestration.ts` | 1637 | ~950 | Drop the transient-retry ladder (3 attempts, 30 s) and let providers retry inside `create`; drop `pendingLog` streaming (16 KiB ring buffer per launch, `takeLaunchLog`, log concatenation in thread provisioning) and keep `step` only; drop replacement-key chains (`resolveThreadMachineLaunchKey` cycle walk) by keying thread launches on `threadId:attempt`; use `lifecycleOwns` everywhere (4.3). The environment orchestrator does the equivalent job in 1096 lines with 16 launch columns; the machine one has 17 columns and 15 exported functions. |
| `plugins/environment-modal-sandbox/server.ts` | 599 | ~420 | 2.1 and 2.2 remove ~120; 3.2 and 3.3 already landed. |
| `apps/app/src/components/dialogs/CreateMachineDialog.tsx` | 490 | ~330 | 2.7 removes the `machineSetup` slot mount and gate plumbing; the inputs UI stays. |
| `apps/server/src/services/machines/enrollments.ts` | 489 | ~300 | `prepare` spends ~120 lines deciding whether to reuse an unexpired sealed bundle (open, hash the credential, check `authApiKeys`). Always reissue on prepare instead; the only reader that needs `open()` is `/install.sh`. |
| `apps/cli/src/commands/machine-lifecycle.ts` | 436 | 0 or ~200 | After 2.1 nothing calls `bb machine stop` remotely. `start` is used by `bootstrap()` for enrolled restarts and `uninstall` by manual. Move both into `install-machine.sh` (`--start`, `--uninstall`), which already knows the service names, or cut the ~150 lines of "belongs to another installation" guards. |
| `apps/app/src/components/settings/MachineEnvironmentSettings.tsx` | 425 | ~220 | Name/value/note table with paste-import parsing. One bulk `PUT` (5.7) removes the per-row save/rollback state; the import parser can be a `<textarea>` of `NAME=value` lines. |
| `apps/server/src/services/machines/lifecycle.ts` | 353 | ~150 | 2.8. |
| `apps/app/src/components/settings/MachineAccessSettings.tsx` | 335 | ~200 | 2.6 removes the fake option and all id branches. |
| `apps/cli/src/commands/machine-enrollment.ts` | 331 | ~200 | Port reservation via mkdir-lock registry (60 lines) and pid-checked enrollment lock (50 lines) protect against two concurrent enrollments on one machine, which the installer already serialises. |
| `packages/agent-runtime/src/thread-event-redaction.ts` + stream | 327 | ~60 | 238 lines walk specific `ThreadEventItem` shapes field by field. The generic JSON string walker (5.3) with the stream redactor covers every string in the event, including future fields. |
| `apps/app/src/components/promptbox/NewThreadComposer.tsx` | +223 | +110 | 1.2: the machine-inputs branch is unreachable for compositions; delete it unless compositions start accepting machine inputs. |
| `plugins/environment-modal-sandbox/account.ts` | 314 | ~220 | 4.8 route table already landed; remaining bulk is nine subcommand usage strings. |
| `plugins/machine-manual/*` | 328 | 0 (+~80 in core) | 2.7. |
| `apps/server/src/services/machines/server-access.ts` | 240 | ~170 | 2.6, legacy fallback into migration. |

Estimated source after all of the above: ~9.5k, roughly -3k from today.

### Tests (+14.3k)

Not read for quality in this review. Two files dominate: `provider-orchestration.test.ts` at 3311 lines and `install-machine-script.test.ts` at 1333 (shell tests spawning the installer). Suggested pass with the repo's bar (a test earns its keep by catching a logic bug, not by exercising a conditional): collapse parameterised matrices that differ only in fixture shape, delete tests of removed behaviour (v1, cancel, allocation none, transient retry if cut), and delete tests that assert the shape of a DTO the type system already fixes. A realistic target is -4k to -5k, most of it in those two files, and it should be a separate worker with that single instruction.

### Stories (+1.3k)

Deliberate, per the commit history. Not counted against the budget.

---

## Post-implementation review (2026-09-10, my read of the committed worker output)

### R1. Core's "stop the daemon before suspend" does not stop the daemon (high)
`apps/server/src/services/machines/provider-orchestration.ts:972-978`; `apps/host-daemon/src/server-connection.ts` (no handling of the close reason); `packages/host-daemon-contract/src/session.ts:318`

`suspendMachine` closes the daemon's WebSocket session with reason `machine-suspend`, checks `hasDaemonForHost` synchronously (true a millisecond after a close), then calls `provider.suspend`. The daemon has no handling for that reason: it is a reconnecting socket and comes back within a second. So Modal snapshots the filesystem with the daemon process alive and possibly mid-write, and nothing rejects the daemon's session open while the host is `suspending` or `suspended`. The previous `bb machine stop` shell snippet was ugly but correct about this. Fix: a `machine.shutdown` command over the session that the daemon acknowledges and then exits on; the server waits for the session close with a timeout before invoking `suspend`; `internal/session.ts` refuses a session open for a host in `suspending` or `suspended` so a stray daemon cannot reattach mid-operation.

### R2. Removal never completes when the access provider is unavailable (medium)
`apps/server/src/services/machines/server-access.ts` (`release`), dev log: "Machine creation cleanup failed: Server access provider is unavailable for cleanup"

`release` throws when the provider is not registered or not paired, so the removal sweep retries every 60 s forever and the host stays in `removing`. Distinguish: provider not registered at all (plugin uninstalled) should skip release and log; provider registered but unpaired should fail with a message the machines page shows, which it does, but with a bounded retry or a "remove anyway" action.

### R3. Modal bakes Modal's defaults into the resource (low)
`plugins/environment-modal-sandbox/server.ts` (`cpu: … ?? 0.125, memoryMiB: … ?? 128`)

When no preset is chosen the resource records today's Modal defaults, and resume passes them explicitly. Keep null in the resource and pass null on resume so Modal's defaults apply.

### R4. Small ones
- Modal `launch` calls `enrollments.prepare` only to learn the host id for the machine name, then `bootstrap()` prepares again. Harmless; `bootstrap` could return the name-relevant host id, or the name could be assigned by core from the reserved id.
- The manual provider's uninstall hint goes into `teardownMessage` right before the host is destroyed, so nobody sees it. Put it in the remove dialog copy for manual hosts only, or drop it.
- `assertHostActiveForRead` in `online-rpc.ts` carries a command-type allowlist (stop, cancel, dispose). Same transport-knows-commands smell as 5.4; acceptable for now.
- `resolve` stores an access-acquisition failure in `teardownMessage` on a host that is being created. Works, reads wrong; `suspendMessage` has the same problem in reverse. One `statusMessage` column would serve all three.

### Reviewed and fine
- Admission flip: reads never call `ensureHostSessionReadyForWork`; work wrappers do; storage location from the persisted `data_dir`; six DB-backed tests.
- Retirement: predicate covers environments, live threads, and live launches; triggers on environment teardown and the periodic sweep; only `ephemeral` providers.
- Composition placement: refuses a machine selection for a different provider, defaults inputs to null, validates through the machine path.
- Manual provider in core: `withManualMachineProvider` wraps the bridge cleanly; prepare always reissues.
- Modal inputs: control reports ready on mount before options load; `{}` is a valid value so send is never gated on the RPC; drawer picker only with more than one choice.
