# Machine lifecycle: core and plugin ownership

Discussion plan, not implemented API. Modal is the concrete provider for validating
this design. API names below marked **proposed** are sketches.

## Ownership

**Core notifies plugins when thread event sequences advance and when terminal input
occurs, and safely executes lifecycle transitions. The plugin decides what counts as activity, when to pause, and how
to perform vendor operations.**

| Responsibility | Owner |
| --- | --- |
| Host identity, threads, environments, enrollment and readiness | Core |
| Debouncing thread event-sequence notifications and publishing real terminal input | Core |
| Deciding which thread events extend the idle deadline | Plugin |
| Idle duration, deadline, timer and provider-specific keep-awake behavior | Plugin |
| Serializing pause/resume/remove and stopping BB work before snapshotting | Core |
| Creating compute, snapshotting, restoring and deleting vendor resources | Plugin |
| Showing Paused versus Offline, transition progress and errors | Core |

Regular hosts stay registered indefinitely, online or offline, as on main. They do
not acquire an idle timer or unsupported pause/resume actions.

## API changes at a glance

| Surface | Change |
| --- | --- |
| `bb.events` | Add `thread.events` and `terminal.input` notifications |
| Provider `experimental_idleSuspendMs` | Remove; plugin owns its timer |
| `bb.sdk.hosts.suspend({ hostId })` | Reuse existing API for every pause request |
| `bb.sdk.hosts.resume({ hostId })` | Reuse existing API for explicit wake-up |
| Provider `suspend` / `resume` callbacks | Keep existing coordinated callbacks |
| `bb.background.schedule` and `bb.storage.kv` | Reuse for plugin scheduling and state |

No activity query, replay API, activity revisions or conditional pause variant.

## 1. Publish thread events and terminal input

**Proposed:** add two notifications to the existing `bb.events` API. Existing
thread lifecycle events remain unchanged.

The examples use the discussion names `thread.events` and `terminal.input`.
Implementation must follow the repository's experimental naming requirement and
record the new surfaces in the API audit before shipping.

```ts
bb.events.on("thread.events", async ({ thread, sequence }) => {
  await handleThreadEventsChanged(thread, sequence);
});

bb.events.on("terminal.input", async ({ terminal }) => {
  await handleTerminalInput(terminal);
});
```

`handleThreadEventsChanged` and `handleTerminalInput` are plugin-local functions,
not new SDK methods. Reuse existing public thread and terminal representations.
The thread notification carries the latest sequence number, not event contents.

### thread.events

Notify when newly appended events advance a thread's event sequence. `sequence`
is that thread's latest event sequence, not a new activity revision. Reading
history or polling does not trigger this notification.

Core debounces notifications **per thread**, coalescing appends and delivering the
latest sequence rather than calling listeners on every append:

- A burst produces a coalesced notification with the latest sequence.
- Continuous output still produces periodic notifications with a bounded maximum
  wait; a trailing-only debounce must not defer delivery indefinitely.
- After output settles, deliver any final sequence not already notified.
- One thread's traffic must not delay another thread's notifications.

Choose the debounce interval and maximum wait during implementation; the contract
requires coalescing and timely delivery, not a callback for every sequence number.

For Modal v1, check `thread.status` in the callback. If it is `active`, bump the
machine's idle deadline. Otherwise do nothing. Any event that advances the sequence
qualifies while the thread is active; there is no event-type classification.

Modal does not fetch event contents or track a processed sequence in v1. The sequence
remains available for plugins that choose to read changes through the existing
thread-events API later. Core does not classify activity for the plugin.

Use the thread status supplied when the callback is delivered. Do not capture status
at append time or add special handling when a thread becomes idle during debounce.
The handler is an announcement and cannot veto the underlying action.

### terminal.input

Notify after real user input is accepted for a terminal, including interactive
programs. It does not include terminal output, connection keepalives or merely
opening a terminal. The notification identifies the terminal; it need not expose
keystrokes or command contents.

Both payloads must let the plugin identify the host associated with the event.
Check existing DTOs and routing before settling the exact fields. Do not attribute
an event from an old execution to a newly selected host. Events without a machine
association do not extend a machine deadline.

### Modal's initial activity policy

| Extends the idle window | Does not extend it |
| --- | --- |
| Thread-sequence notification when `thread.status === "active"` | Thread-sequence notification when the thread is not active |
| Real user terminal input, including interactive programs | Terminal output, idle shells, heartbeats |
| Any event type while the thread is active | A turn or command merely remaining active without new events |
| Plugin's own explicit deadline bump | Viewing history or Git/PR polling without event appends |

A silent long-running tool or terminal command can be interrupted by idle pause.
Future settings may let active work keep compute awake; those settings are not
part of this work. Keeping the activity decision in Modal allows its policy to change
without inventing another core activity API.

Receiving either notification does not itself wake a paused machine. Modal starts
a fresh window as part of successful creation/resume, separately from thread and
terminal events. We are not adding a synthetic readiness-as-activity notification.

## 2. Move the idle timer into Modal

Remove this provider member and the core idle scheduler that consumes it:

```ts
experimental_idleSuspendMs(context): Promise<number | null>;
```

Modal owns its configured duration, initially 15 minutes, and its persisted
`pauseAt`. There is no second core timeout override.

The following is **illustrative plugin code**. All helpers other than `bb.*` are
plugin-local, not proposed SDK APIs. Host lookup identifies a machine owned by Modal;
deadline storage uses existing `bb.storage.kv`. Modal v1 does not need to consume
`sequence` or look up the underlying events.

```ts
bb.events.on("thread.events", async ({ thread }) => {
  if (thread.status !== "active") return;
  const hostId = await ownedHostForThread(thread);
  if (!hostId) return;
  await idleDeadlines.extend(hostId, Date.now() + idleDurationMs);
});

bb.events.on("terminal.input", async ({ terminal }) => {
  const hostId = await ownedHostForTerminal(terminal);
  if (!hostId) return;
  await idleDeadlines.extend(hostId, Date.now() + idleDurationMs);
});

bb.background.schedule("pause-idle-machines", "* * * * *", async () => {
  for (const hostId of await idleDeadlines.due(Date.now())) {
    await bb.sdk.hosts.suspend({ hostId });
    await idleDeadlines.clear(hostId);
  }
});
```

This sketch shows ownership, not complete timer/error handling. Modal must report
pause failures and avoid treating them as success. Its stored deadlines let its
scheduler continue after a server restart; no new core event catch-up mechanism is
added.
A minute sweep starts pausing on the next sweep after expiry, not at an exact second.

Modal can extend the same deadline for its own reasons:

```ts
await idleDeadlines.extend(hostId, Date.now() + idleDurationMs);
```

Extending a deadline does not wake compute. To wake it, the plugin uses the existing
core operation:

```ts
await bb.sdk.hosts.resume({ hostId });
```

For this Modal implementation, “bump” means changing the plugin's deadline. The
pinned Modal JS SDK 0.10.0 exposes maximum-lifetime and idle-termination creation
options, but its public Sandbox declaration has no timeout-extension method.
Vendor idle termination is not our snapshot-and-pause flow. Another provider may
also extend a native lease; that stays inside its plugin.

An idle bump does not promise to extend a vendor's hard lifetime. This plan adds
no pre-expiry scheduler or automatic recovery from an older snapshot.

## 3. One pause operation

The plugin's idle timer and a user's Pause action use the same operation:

```ts
await bb.sdk.hosts.suspend({ hostId });
```

There is one pause request. The plugin decides when to request pause; core validates
it and can reject unsupported or conflicting operations, such as removal already
being underway. If core cannot safely stop work, it fails before invoking the
provider callback. An active turn or terminal command alone is not a rejection
reason: core can interrupt it.

```text
Plugin timer or user Pause
  → core validates the request and enters Pausing
  → follow-ups remain accepted; their execution waits during coordination
  → core interrupts/drains turns, setup work and terminals within a finite bound
  → core invokes the provider's suspend callback
  → plugin preserves state and stops compute
  → core marks the host Paused
```

Remove the current open-terminal/active-work veto. A long-running command does not
prevent pause. Interrupted work must not be shown as successfully completed.
Lifecycle operations remain serialized; work cannot run during a snapshot.

### Follow-ups sent during Pausing

The composer stays usable. Core accepts and queues the follow-up immediately;
the user never has to resend it or click Resume to continue.

- Before preservation begins, cancel the pending pause and run the follow-up after
  any in-flight stopping work has settled and the host is ready to execute.
- Once preservation has begun, finish pausing, automatically resume, then execute
  the queued follow-up after readiness. Do not run it against a snapshot in progress.

With the existing opaque provider callback, core uses invocation of `suspend` as
its preservation boundary. It cannot observe exactly when vendor snapshotting
starts inside that callback. Before invocation it can cancel; after invocation it
finishes the transition and resumes for queued work. This needs no new plugin hook.

Core serializes that boundary with accepting follow-ups so a message takes one
path. A cancelled pause must not be reported as a successful suspension. Work
already interrupted by the pause remains interrupted; cancellation does not pretend
that stopped processes continued running. If pause or resume fails, preserve the
queued follow-up and show the error rather than silently dropping or executing it
on an unready host.

Keep the existing callback/resource checkpoint contract. For Modal, the callback
stops the daemon, snapshots the filesystem, durably records the snapshot identity,
and then terminates compute. A failed snapshot is a visible pause failure.

## 4. Resume through core

Existing API, called by the UI, CLI or plugin:

```ts
await bb.sdk.hosts.resume({ hostId });
```

```text
Paused → Resuming
  → plugin restores compute with the same host identity
  → core waits for connection and workspace readiness
  → core marks it ready
  → accepted execution can proceed
```

User actions that require execution, such as sending a message, can request this
coordinated wake. Background reads cannot. Concurrent execution requests must not
create separate restores, and failed resume must leave a visible error.

Modal restores files, not running process memory. Old terminal input must not be
replayed into a replacement shell. Missing vendor compute must not silently become
an empty machine or an unacknowledged rollback to an older snapshot.

## 5. Product behavior and passive reads

- Show Paused separately from Offline, with a Resume action where supported.
- Keep thread history readable while paused.
- Background Git/PR requests return cached or unavailable information without
  resuming compute or extending the deadline.
- Give users an explicit way to resume when fresh host-local information is needed.
  Final refresh wording is a UI decision; polling must remain passive.
- Ordinary offline hosts retain reconnect guidance.

Audit callers of `callHostRetryableOnlineRpc`: background Git/PR queries currently
use a path that can resume compute. Make wake-up an intentional execution decision,
not a side effect of reading status.

## Implementation order

1. Confirm payload host associations and add the debounced thread-sequence and
   terminal-input notifications. Modal bumps on a thread notification only when
   `thread.status === "active"`, and separately on real terminal input. Document
   the experimental contracts in the Plugin Guide/API audit.
2. Move Modal's timer into the plugin using existing scheduling/storage; remove
   `experimental_idleSuspendMs` and the competing core idle loop together.
3. Make the existing suspend route coordinate interruption regardless of active
   turns or terminals. Preserve bounded drain, checkpoints and transition fencing.
4. Separate passive reads from wake-up and add paused-state product treatment.
5. Verify Modal end to end before expanding the contract for other providers.

Keep creation, interrupted-allocation cleanup, opaque resource checkpoints and
explicit removal. Do not reintroduce retention/keep, a core snapshot catalogue or
a generic vendor-observation framework.

## Verification

Use real migrated databases and controlled vendor operations for focused tests:

- Bursts of thread appends coalesce to the latest sequence; continuous output gets
  periodic notifications and a final trailing update without cross-thread delays.
- Modal bumps on thread notifications when the callback's thread is active and
  ignores them otherwise, without fetching events or capturing earlier status.
- Real terminal input reaches listeners; opening history or polling emits no
  thread-sequence notification.
- Any event type qualifies while the thread is active. Notifications affect only
  the associated Modal machine; passive reads alone do not extend its deadline.
- A silent active turn, long-running terminal command or terminal output does not
  prevent pause under the default policy.
- Plugin deadline extension and explicit plugin wake both work through their
  respective paths.
- Pause blocks execution before snapshotting and marks interrupted work correctly.
- A follow-up during pre-callback Pausing is accepted, cancels the pause, and runs
  after stopping work settles; the provider suspend callback is not invoked.
- A follow-up after the provider callback starts is accepted, waits for pause and
  automatic resume, then runs once without requiring user Resume or resend.
- Unsupported/conflicting pause requests are rejected; stopping failures do not
  invoke provider suspension or lose queued follow-ups.
- Resume restores once, retains host identity and waits for readiness.
- Failed snapshots/resumes remain visible; successful retries clear stale errors.
- Viewing a paused thread never creates compute through background requests.
- Regular hosts keep their existing online/offline behavior.

Live Modal validation should exercise a short configured idle window, meaningful
activity, automatic pause, passive history viewing and explicit resume on designated
test resources.
