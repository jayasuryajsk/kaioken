# PR #3274 — machine providers, enrollment, and server access

## What problem this solves

Environment providers can create a workspace on an existing machine. This branch
adds the preceding step: obtain a machine, enroll its daemon, give it a reachable
server address, and recover or clean up if creation is interrupted.

The PR targets `main` and includes Manual setup (#3275), Connect access (#3280),
and Modal sandboxes (#3279). SSH, Tailscale, and DigitalOcean remain separate PRs.

## How it works

```text
Create machine
  → persist launch and stable retry key
  → prepare enrollment and server access
  → plugin allocates or recovers compute
  → persist provider resource checkpoint
  → install/connect daemon

Run a project on that machine
  → prepare project source
  → create workspace through its environment provider
  → run setup and check agent readiness
  → start work
```

Machines belong to no project. Creation no longer accepts `projectId`, `gitRemote`,
or provider `requires` declarations. The CLI's `machine create --project` option
is removed. Projects reach machines afterward through project sources.

## Contract boundaries

| Owner | Responsibility |
| --- | --- |
| Core server | Enrollment, access grants, durable launches, retries, readiness, coordinated suspend/resume/removal |
| Machine plugin | Allocate/remove compute, recover uncertain allocations, preserve files, maintain vendor resource metadata |
| Server-access plugin | Supply a reachable URL and authentication headers; release access when finished |
| Environment plugin | Create and remove workspaces on a machine |
| Host daemon | Execute commands and manage host-local workspaces and agent sessions |

Existing environment-provider ownership checks, workspace path reservations, and
setup/teardown hooks are inherited from main. This branch connects machine
provisioning and restoration to those mechanisms.

The main plugin surfaces are:

```ts
bb.experimental_machines.register(provider);
bb.experimental_serverAccess.register(accessProvider);
bb.experimental_serverAccess.recheck();
```

`recheck()` refreshes availability and notifies clients. Connect invokes it when
pairing or its public URL changes, preventing stale access settings.

Creation receives a stable `key`, attempt number, parsed inputs, progress reporter,
abort signal, and asynchronous `checkpoint(resource)`. Plugins must reuse the key
across retries. Checkpoints persist recovery metadata; they do not save files.
Inputs and resource metadata must not contain credentials.

`remove({ resource })` deletes a known allocation. `reconcileCleanup({ key })`
finds and removes an uncertain allocation—for example, a successful cloud request
whose response was lost. It must never create or bootstrap a machine.

## Included providers and UI

- **Manual:** the plugin owns the installer command, copying, expiry countdown,
  and retry UI through `app.slots.experimental_machineSetup`.
- **Connect:** supplies machine-access grants and recovers interrupted credential
  redemption. Internal credentials use private plugin storage.
- **Modal:** supplies a bundled/customizable tools Dockerfile, cached image builds,
  sandbox creation, manual/idle snapshots, same-host restore, and CLI image/debug
  sandbox commands. It does not schedule snapshots ahead of vendor expiry.

Add a machine checks access first, then lists providers or opens the only provider.
The access gate and Machines settings share controls and state, with separate
layouts. Manual URLs require an explicit Save and reject localhost.

Advanced settings contains machine access and shared environment variables. All
saved variable values are encrypted in the database and masked in list responses.
The automatic `GH_TOKEN` comes from the server's `gh` login and can be disabled;
a user-supplied token overrides it.

## Lifecycle and data model

Modal owns its idle timer through debounced thread-sequence and terminal-input events.
For v1, a thread notification bumps the timer only when the delivered thread is active.
Core no longer owns an idle-timeout hook; it coordinates suspension:

```text
sdk.hosts.suspend({ hostId })
  → block new work
  → drain active turns, setup hooks, and terminals (up to five minutes)
  → plugin checkpoints resource and suspends compute
  → record suspended state

Resume → restore same host identity → reconnect → run restore setup/readiness
```

Core retention/keep, automatic retirement, vendor observation, expiry scheduling,
snapshot tracking, and overlapping static/dynamic policies are removed. Explicit
removal and interrupted-allocation cleanup remain. Plugins own actual snapshots
and must refuse unsafe restoration rather than silently start an empty machine.

`0115_machine_providers` adds launch, enrollment, lifecycle, setup/restore records,
and host ownership/state fields. Existing remote hosts are assigned to Manual;
the local host remains provider-less. `0116` removes the launch's project ID.
Migrations inherited from main are unchanged. SDK version: **0.4.64**;
daemon protocol: **196**.

## Verification and open issues

Modal integration passed 47 plugin tests, typecheck/lint, 98 core lifecycle and
registration tests, artifact tests, and app/server/CLI builds and typechecks.
The latest CI failure was a stale `requires.gitRemote` test expectation; its
five-test suite passes after the fix in `cf0d2b1181`. A new CI result is not claimed.

Known gaps:

- Required workspace cleanup can block removal when a machine is unavailable;
  explicit abandonment is not implemented.
- Modal testing found that background Git/PR queries while viewing thread history
  can resume suspended compute.
- Successful resume clears stale lifecycle errors.

[Test app](https://ymichael--19635.getbb.app/settings/machines). Modal is installed;
live provisioning needs account credentials and incurs vendor usage. No paid
resources were created during integration.
