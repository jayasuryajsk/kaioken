# Environment providers and machine composition

Agreed scope. Implementation in progress; keep this document uncommitted.

## User experience

The environment picker offers one **Modal sandbox** option for a new sandbox.
Existing sandbox hosts retain their normal checkout/worktree choices. Plugins
that register only machines contribute no environment-picker options; they
remain available through Machines settings and the machine SDK/CLI.

```text
New thread → Modal sandbox
  → Modal machine provider creates and enrolls the machine
  → Core sets up the project's checkout on that host
  → Project-checkout environment provider attaches to it
  → Core runs environment setup and starts the thread
```

Keep “Set it up on Machine X” and its existing core checkout setup unchanged.
Modal reuses that core cloning/project-source logic. There is no new git-clone
plugin and no missingProjectCheckout API. Cloning can be extracted later if
there is a concrete reason, without changing the ownership model now.

## Registration

Modal registers both a machine provider and an environment composition:

```ts
bb.experimental_machines.register({
  id: "modal-sandbox",
  displayName: "Modal sandbox",
  create: createSandbox,
  reconcileCleanup: cleanupUncertainSandbox,
  suspend: suspendSandbox,
  resume: resumeSandbox,
  remove: removeSandbox,
});

bb.experimental_environments.register({
  id: "modal-sandbox",
  displayName: "Modal sandbox",
  machineProviderId: "modal-sandbox",
  environmentProviderId: "project-checkout",
});
```

The composition is a registration form, not a third lifecycle implementation.
It references one machine provider and one concrete environment provider. It
cannot also declare create/remove callbacks. The concrete environment provider
supplies requirements and input schema; Modal uses its existing machine defaults.
No nested compositions or generic input-mapping mechanism in this change.

## Boundaries and records

| Responsibility | Owner |
| --- | --- |
| Create, enroll, pause, resume and remove Modal compute | Modal machine provider |
| Clone missing project checkout and register the project source | Existing core checkout setup |
| Attach to the resulting path and select branch | Project-checkout environment provider |
| Sequence creation, record progress, run setup hooks, start thread | Existing core provisioning lifecycle |

Resolve the composition on the server before the launch is persisted. Store the
concrete project-checkout selection and the explicit new-machine selection in
existing records. The resulting environment belongs to project-checkout, so a
later thread can reuse it without a cross-provider path ownership conflict.
No new database model or machine/environment lifecycle is required.

## Failure and timeline behavior

If cloning fails after machine creation, retain the machine and record the
failure. The user can retry the thread or explicitly remove the machine. Do not
silently delete ready compute as a consequence of a checkout failure.

All stages appear in the thread's existing provisioning details: machine
creation/connection, project checkout setup, environment setup, and completion
or failure with the error. Preserve provider progress as the flow enters clone
setup; do not lose machine logs at that transition.

Pause/resume and existing checkout cleanup policies stay unchanged. No clone
on resume and no automatic machine deletion when a thread ends.

## Picker, SDK and CLI

- Environment options come from environment registrations, not machine providers.
- Modal appears once, outside existing-host groups, and needs no selected host.
- Compositions inherit their machine provider's setup-required state.
- Explicit SDK/CLI composition selection omits machine selectors; core chooses
  the declared machine. Conflicting selectors are rejected, not ignored.
- Ordinary environment selections still require a machine selection.
- Remove environmentRow, its projection and all client/CLI inference.

```ts
await sdk.threads.spawn({
  projectId,
  input,
  environment: {
    type: "provider",
    environmentProviderId: "modal-sandbox",
    inputs: {},
  },
});
```

```sh
bb thread spawn --project PROJECT --environment-provider modal-sandbox --prompt "..."
```

## Verification

- Machine-only registration creates no environment-picker option.
- Modal composition is selectable without a host and appears only once.
- SDK and CLI use the same composition as the UI.
- Missing provider/required Git remote and conflicting machine selectors fail
  before allocation; missing Modal configuration is shown as setup-required.
- A successful composed launch creates the machine, prepares the checkout,
  records project-checkout ownership and starts the thread.
- Later checkout/worktree creation reuses that project source without cloning again.
- Clone failure preserves the ready machine and reports the error in the timeline.
- Registration validation and Plugin Guide/API audit match the new contract.
- Live UI checks do not provision paid resources without authorization.
