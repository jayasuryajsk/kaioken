# PR3274 Plugin API review

This branch lets a plugin create a machine, connect it to bb, and optionally pause/resume it. A separate environment provider sets up the workspace on that machine.

This review includes current uncommitted changes. “New” and “breaking” are relative to this branch's merge base with main.

**How to read the code:** method names, parameters, optional fields and return values match the implementation. Type aliases and inheritance are expanded where useful. `Inputs` below means the parsed value of the plugin's input schema; without a schema it is `null`. `InputSchema` means a Standard Schema implementation such as Zod. These are explanatory names, not new SDK exports.

Start with sections 1–7 for the provider design. Sections 9–12 cover SDK methods and data changes; the last section lists concerns worth discussing.

## Review map

| Surface                                 | Compared with main              | What it is for                                                                    |
| --------------------------------------- | ------------------------------- | --------------------------------------------------------------------------------- |
| `bb.experimental_machines`              | New                             | Register machine providers; prepare enrollment; bootstrap; read resource metadata |
| `@get-bb/plugin-sdk/machine-provider`   | New export path                 | Provider callbacks and their typed contexts/results                               |
| `bb.experimental_serverAccess`          | New                             | Give machines a reachable server URL and access headers                           |
| `bb.experimental_environments.register` | Extended                        | Compose a machine provider with an existing environment provider                  |
| Environment input props                 | Breaking                        | Replace nullable `hostId` with explicit `target`                                  |
| Machine inputs/setup slots              | New                             | Provider-owned creation inputs and standalone setup UI                            |
| Thread/terminal events                  | New event names on existing bus | Let plugins observe activity and implement idle policy                            |
| `bb.sdk.hosts`                          | New methods; changed Host DTO   | Create/follow/cancel machines and coordinate suspension/resumption                |
| `bb.sdk.system`                         | New methods/results/settings    | Shared machine environment variables and access configuration                     |
| Branch picker props type                | Existing                        | Keeps the existing `BranchPickerProps` name                                       |
| Testing SDK                             | Extended                        | Capture registrations and inject bootstrap/resource implementations               |

The concrete consumers in this PR are Manual machine setup, Connect server access, and Modal Sandbox. SSH, Tailscale, and DigitalOcean are separate PRs.

## 1. Machine providers — new

Core owns durable launch identity, enrollment, progress, operation coordination and cleanup retries. The plugin owns vendor allocation, removal and any filesystem preservation. Machine creation is project-independent.

### What the plugin registers

For example, a provider chooses its ID, declares inputs, and implements allocation/cleanup:

```ts
bb.experimental_machines.register({
  id: "my-sandbox",
  displayName: "My sandbox",
  description: "Create a cloud sandbox for development.",
  icon: "Cloud",
  inputs: z.object({ region: z.string() }),
  create,
  reconcileCleanup,
  remove,
});
```

Here `create`, `reconcileCleanup`, and `remove` are the plugin's functions. The full registration shape is:

```ts
interface MachineProvider {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  machineTag?: string;
  inputs?: InputSchema;

  availability?(): Availability | Promise<Availability>;
  validate?(context: { inputs: Inputs }): Validation | Promise<Validation>;

  create(context: {
    inputs: Inputs;
    key: string;
    attempt: number;
    checkpoint(resource: JsonValue): Promise<void>;
    report: Progress;
    signal: AbortSignal;
  }): Promise<CreateResult>;

  reconcileCleanup(context: {
    key: string;
    report: Progress;
    signal: AbortSignal;
  }): Promise<RemoveResult>;

  remove(context: {
    hostId: string;
    resource: JsonValue;
    report: Progress;
    signal: AbortSignal;
  }): Promise<RemoveResult>;

  suspend?(context: {
    hostId: string;
    resource: JsonValue;
    checkpoint(resource: JsonValue): Promise<void>;
    report: Progress;
    signal: AbortSignal;
  }): Promise<{ resource: JsonValue }>;

  resume?(context: {
    hostId: string;
    resource: JsonValue;
    checkpoint(resource: JsonValue): Promise<void>;
    report: Progress;
    signal: AbortSignal;
  }): Promise<{ resource: JsonValue }>;
}
```

### What those callbacks return

```ts
type Availability =
  | { status: "available" }
  | { status: "setup-required"; message: string }
  | { status: "unavailable"; message: string };

type Validation = { action: "accept" } | { action: "refuse"; message: string };

type CreateResult =
  | { status: "created"; hostId: string; resource: JsonValue }
  | {
      status: "failed";
      failure: "transient" | "terminal";
      message: string;
      allocation?: "none";
    };

type RemoveResult =
  | { status: "removed" }
  | { status: "failed"; message: string };

interface Progress {
  step(text: string): void;
  log(text: string): void;
}
```

These short names correspond to the SDK's `PluginMachineProviderDefinition`, `PluginMachineProviderAvailability`, `PluginMachineValidateDecision`, `PluginMachineProviderCreateResult`, `PluginMachineProviderRemoveResult`, and `PluginMachineProviderProgress`.

`PluginMachineProviderDeclaration` is just an alias for this provider definition. Its generic machinery makes the schema above give `create` an `inputs.region: string`. It adds no callback or runtime behavior.

### What the plugin can read

```ts
interface PluginMachines {
  getResource(hostId: string): Promise<JsonValue | null>;
}
```

Call `bb.experimental_machines.getResource(hostId)`. It reads core's saved resource metadata, not live vendor state. Null means no host/resource was found.

Read these contracts as follows:

- `key` identifies a retryable allocation; `attempt` identifies the current attempt. Plugins must avoid allocating a second resource for the same key.
- `checkpoint(resource)` saves opaque recovery metadata in core. It does not snapshot files. Prepare enrollment, checkpoint allocation metadata, then bootstrap.
- `created` returns the enrolled host identity and final resource. A failure with `allocation: "none"` means definitively nothing was allocated; omitting it leaves allocation uncertain.
- `remove` handles a known resource. `reconcileCleanup` finds and removes an uncertain allocation by key; it must not create or bootstrap one.
- `suspend` and `resume` are optional but registration requires them together.
- The input schema is Standard Schema, with output inferred into callbacks; no schema means `inputs: null`.
- Inputs/resource metadata are not a credential store. Resources are readable through the cross-plugin resource getter.
- `getResource` returns null for an absent host/resource; it does not ask the vendor for current state.

All three checkpoint callbacks return `Promise<void>`. Await them before bootstrap or terminating compute so a persistence failure prevents the next step.

Source: [machine-provider.ts](packages/plugin-sdk/src/machine-provider.ts), [backend-contract.ts](packages/plugin-sdk/src/backend-contract.ts).

## 2. Enrollment and bootstrap — new

The plugin calls:

```ts
const enrollment = await bb.experimental_machines.enrollments.prepare({ key });
if (enrollment.state === "pending") {
  const installer = bb.experimental_machines.installerCommand(
    enrollment.bootstrap,
  );
}
```

An already-enrolled result has no bootstrap credentials. Full method and data shapes follow.

```ts
interface EnrollmentBootstrap {
  version: 2;
  hostId: string;
  serverUrl: string;
  headers?: Record<string, string>;
  credential: string;
  expiresAt: number;
}

type MachineEnrollment =
  | {
      id: string;
      hostId: string;
      state: "pending";
      bootstrap: EnrollmentBootstrap;
      expiresAt: number;
    }
  | { id: string; hostId: string; state: "enrolled" };

interface MachineExecutorRequest {
  command: string[];
  timeoutMs: number;
  signal: AbortSignal;
  stdin?: string;
}

interface MachineExecutor {
  exec(
    request: MachineExecutorRequest,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

interface MachineEnrollmentRequest {
  key: string;
  access?: ServerAccessSelection;
}

interface MachineConnectionRequest {
  enrollmentId: string;
  timeoutMs: number;
  signal: AbortSignal;
}

interface MachineEnrollments {
  prepare(request: MachineEnrollmentRequest): Promise<MachineEnrollment>;
  waitForConnection(
    request: MachineConnectionRequest,
  ): Promise<{ hostId: string }>;
  cancel(request: { enrollmentId: string }): Promise<void>;
}

interface MachineBootstrapRequest {
  key: string;
  access?: { providerId: string };
  executor: MachineExecutor;
  daemon: { kind: "preinstalled" } | { kind: "install" };
  report: PluginMachineProviderProgress;
  signal: AbortSignal;
}

interface MachineInstallerCommand {
  command: string[];
  stdin: string;
}

interface MachineBootstrapApi {
  enrollments: MachineEnrollments;
  installerCommand(bootstrap: EnrollmentBootstrap): MachineInstallerCommand;
  bootstrap(request: MachineBootstrapRequest): Promise<{ hostId: string }>;
}
```

`enrollments.prepare({key})` establishes/reuses an identity scoped to the plugin. A pending result contains sensitive bootstrap credentials; an enrolled result contains no new command. `waitForConnection` waits for enrollment/connection; it is not an agent authentication or checkout-readiness check.

`installerCommand` returns an argv array and private stdin. `bootstrap` uses the supplied executor to install/start the daemon. `daemon.kind` chooses preinstalled tools versus installation. A restored machine reuses the existing enrolled identity.

The bootstrap bundle is version 2 with optional HTTP headers. Version 1 is a compatibility concern within this branch's development history, not an API that existed on main at this comparison base.

Manual keeps the pending prepare result in memory and retrieves its command through its own RPC. It does not use a generic enrollment `.get` API. Reload/restart does not recover that UI cache.

Source: [machine-bootstrap.ts](packages/plugin-sdk/src/machine-bootstrap.ts), [Manual RPC](plugins/machine-manual/rpc.ts).

## 3. Server access providers — new

Machine provisioning answers “where does compute come from?” Server access answers “how does that machine reach/authenticate to this server?” These are separate registrations.

```ts
interface ServerAccessGrant {
  id: string;
  serverUrl: string;
  headers?: Record<string, string>;
}

interface ServerAccessSelection {
  providerId: string;
}

type AccessAvailability =
  | { status: "available"; serverUrl?: string }
  | { status: "setup-required"; message: string; serverUrl?: string }
  | { status: "unavailable"; message: string; serverUrl?: string };

interface ServerAccessProviderDeclaration {
  id: string;
  displayName: string;
  availability(): AccessAvailability | Promise<AccessAvailability>;

  acquire(context: {
    key: string;
    hostId: string;
    signal: AbortSignal;
  }): Promise<ServerAccessGrant>;
  release(context: {
    key: string;
    hostId: string;

    grantId: string | null;
  }): Promise<void>;
}

interface PluginServerAccess {
  register(declaration: ServerAccessProviderDeclaration): void;

  recheck(): void;
}
```

- `availability` reports configuration readiness; optional `serverUrl` is display metadata, not proof a remote machine can reach it.
- `acquire` returns a grant with server URL and optional headers. Those headers are used for enrollment and subsequent runtime requests.
- `release` gets a nullable grant ID because acquisition may have been interrupted before returning. The key/host identify unfinished acquisition.
- `recheck()` is a void notification to refresh configuration clients. Existing environment-provider `recheck()` returns a Promise; these signatures are currently inconsistent.
- An ordinary thrown error is redacted. Deliberate recovery messages use an Error whose **name** is `experimental_ServerAccessRecoveryError`; there is no exported error class:

```ts
const error = new Error("Reconnect your account to restore machine access.");
error.name = "experimental_ServerAccessRecoveryError";
throw error;
```

Connect is the plugin implementation in this PR; direct/manual URL access is core-owned. Credential material belongs in private storage, not provider resource metadata or exposed settings.

## 4. Environment composition — extension to an existing API

Environment providers, their lifecycle callbacks, input schemas, requirements, path claims, and environment retirement policy already existed on main. This PR adds a second registration form:

```ts
interface EnvironmentComposition {
  id: string;
  displayName: string;
  icon?: string;
  machineProviderId: string;
  environmentProviderId: string;
  create?: never;
  remove?: never;
}

interface PluginEnvironments {
  register(declaration: EnvironmentComposition): void;
  recheck(): Promise<void>;
}
```

This shows the new registration form. The existing form that accepts an environment provider with create/remove callbacks remains available.

```ts
bb.experimental_environments.register({
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  machineProviderId: "modal-sandbox",
  environmentProviderId: "project-checkout",
});
```

The composition has no create/remove callbacks or inputs of its own. Core resolves it to a machine provider plus concrete environment provider. Core provisions the machine and then invokes existing environment setup with a real host.

The picker keeps the composition's label and reuses the target environment provider's inputs. Machine-only registrations do not create environment-picker entries. Ordinary environment selections still name an existing machine; a composition submission omits the machine because registration supplies it.

New/expanded wire types used by thread creation and dispatch hooks:

```ts
type EnvironmentMachineSelection =
  | { type: "existing"; hostId: string }
  | { type: "new"; machineProviderId: string; inputs: JsonValue | null };

type ProviderEnvironmentArgs = {
  type: "provider";
  environmentProviderId: string;
  machine?: EnvironmentMachineSelection;
  inputs: JsonValue | null;
};
```

```ts
type PluginDispatchEnvironmentIntent =
  | { kind: "environment"; environmentId: string }
  | {
      kind: "provider";
      environmentProviderId: string;
      machine:
        | { type: "existing"; hostId: string }
        | {
            type: "new";
            machineProviderId: string;
            inputs: JsonValue | null;
          };
      inputs: JsonValue | null;
    };
```

The transport schema defaults omitted input values to null. It allows omitted `machine` for compositions; core validates that omission against the selected registration. The dispatch hook sees the resolved explicit machine intent.

**Breaking for exhaustive consumers:** code that assumes every machine selection has `hostId` must now narrow `machine.type`.

### Checkout ownership passed to environment providers

Core can now tell an environment provider whether it owns the checkout it is handing over:

```ts
type ProjectCheckout = {
  path: string;
  experimental_ownsPath?: boolean;
};
```

That object is available as `context.projectCheckout` in availability, validate and create callbacks. It is nullable unless the provider declares that it requires a checkout. Core supplies the ownership boolean for its cloned checkout; missing means unowned.

**Nothing else in those backend callback signatures changed.** In particular, create still receives a real `host`, not the frontend `target` union. Existing path claims, progress, removal and retirement policy came from main.

Source: [environment-provider.ts](packages/plugin-sdk/src/environment-provider.ts), [shared request types](packages/server-contract/src/api/shared.ts).

## 5. Environment inputs — breaking prop change

Previously:

```ts
interface PluginEnvironmentProviderInputsProps {
  projectId: string | null;
  hostId: string | null;
  value: JsonValue | null;
  onChange(next: PluginEnvironmentProviderInputsChange): void;
}
```

Now, including the unchanged registration/change types:

```ts
interface PluginEnvironmentProviderInputsProps {
  projectId: string | null;

  target: { kind: "existing-host"; hostId: string } | { kind: "new-host" };

  value: JsonValue | null;

  onChange(next: PluginEnvironmentProviderInputsChange): void;
}

type PluginEnvironmentProviderInputsChange =
  | { status: "ready"; value: JsonValue }
  | { status: "blocked"; reason: string };

interface PluginEnvironmentProviderInputsRegistration {
  environmentProviderId: string;
  component: ComponentType<PluginEnvironmentProviderInputsProps>;
}
```

`target` belongs to input component props only. The registration does not receive a target, and backend create continues receiving a real host.

- Existing-host selection: `{kind: "existing-host", hostId}`.
- New-machine composition: `{kind: "new-host"}`.
- Project checkout handles repository branch selection before provisioning once, so Modal and other compositions reuse it.
- There is currently **no** `supportsNewHost` declaration or separate opt-in. Providers used by a composition must handle the new target; this remains a point to review rather than an implemented compatibility guard.

Project checkout and Worktree input components were updated for the breaking prop replacement.

## 6. Machine frontend slots — new

```ts
interface PluginMachineProviderInputsProps {
  value: JsonValue | null;

  onChange(next: PluginMachineProviderInputsChange): void;
}

type PluginMachineProviderInputsChange =
  | { status: "ready"; value: JsonValue }
  | { status: "blocked"; reason: string };

interface PluginMachineProviderInputsRegistration {
  machineProviderId: string;
  component: ComponentType<PluginMachineProviderInputsProps>;
}

interface ExperimentalMachineSetupProps {
  client: {
    hosts: {
      experimental_submit(
        args: MachineCreateArgs,
      ): Promise<MachineLaunchStatus>;
      experimental_follow(args: {
        id: string;
        signal?: AbortSignal;
        onProgress?: (status: MachineLaunchStatus) => void;
      }): Promise<Host>;
      experimental_cancel(args: { id: string }): Promise<MachineLaunchStatus>;
    };
  };
  onClose(): void;
}

interface ExperimentalMachineSetupRegistration {
  machineProviderId: string;
  component: ComponentType<ExperimentalMachineSetupProps>;
}
```

```ts
interface PluginAppSlots {
  experimental_machineProviderInputs(
    registration: PluginMachineProviderInputsRegistration,
  ): void;
  experimental_machineSetup(
    registration: ExperimentalMachineSetupRegistration,
  ): void;
}
```

These are additions to the existing slots interface. Machine inputs collect non-secret JSON; setup is a provider-owned standalone dialog experience. Core checks plugin ownership and blocks setup until server access is configured.

`client.hosts` in setup exposes only submit/follow/cancel, with the full signatures shown in section 9. There is no core enrollment-command client in these props. Manual uses its own command RPC.

The existing `experimental_providerIcon` slot also accepts machine provider IDs now; its registration signature did not change.

Machine inputs and provider listing are project-independent, matching machine creation.

## 7. Activity events — new names on the existing event bus

Plugins subscribe using the existing `bb.events.on`. These are the two new event signatures; the generic event-map plumbing is omitted:

```ts
interface PluginEvents {
  on(
    event: "experimental_thread.events",
    handler: (payload: {
      thread: ThreadResponse;
      sequence: number;
    }) => void | Promise<void>,
  ): void;

  on(
    event: "experimental_terminal.input",
    handler: (payload: { terminal: TerminalSession }) => void | Promise<void>,
  ): void;
}
```

For example, Modal receives a thread notification like this:

```ts
bb.events.on("experimental_thread.events", async ({ thread }) => {
  if (thread.status !== "active" || thread.environmentId === null) return;

  const environment = await bb.sdk.environments.get({
    environmentId: thread.environmentId,
  });

  await bumpOwnedMachine(environment.hostId);
});
```

`bumpOwnedMachine` is Modal's own helper, not an SDK method.

Core coalesces thread event appends per thread into one notification per one-second window. Delivery includes the latest sequence and current thread DTO. It does not include raw events, classify progress, replay notifications, or emit on reads.

Terminal input notifications follow real accepted nonempty user input, including interactive programs. They contain the existing terminal DTO with its host identity, not input bytes. Output and keepalives do not emit them.

Modal v1 bumps its own idle deadline when the delivered thread is active, or when terminal input targets its machine. It uses existing plugin KV/background scheduling and the new SDK suspend call. No core idle-duration policy or conditional pause API was added.

## 8. Storage — unchanged API

Connect stores its pairing credential and machine-access credentials in existing plugin KV, outside settings descriptors and the configuration UI. No new storage API is added. Shared machine environment values separately use encrypted database storage.

## 9. Public SDK machine methods — new through existing bb.sdk

Call these methods through `bb.sdk.hosts`. Their full signatures are:

```ts
interface HostsArea {
  experimental_create(args: MachineCreateArgs): Promise<Host>;
  experimental_submit(args: MachineCreateArgs): Promise<MachineLaunchStatus>;
  experimental_launch(args: {
    id: string;
    scope?: "launch" | "thread";
    signal?: AbortSignal;
  }): Promise<MachineLaunchStatus>;
  experimental_cancel(args: { id: string }): Promise<MachineLaunchStatus>;
  experimental_follow(args: {
    id: string;
    signal?: AbortSignal;
    onProgress?: (status: MachineLaunchStatus) => void;
  }): Promise<Host>;
  experimental_listProviders(args?: {
    signal?: AbortSignal;
  }): Promise<SystemMachineProvider[]>;
  experimental_suspend(args: { hostId: string }): Promise<{ ok: true }>;
  experimental_resume(args: { hostId: string }): Promise<{ ok: true }>;
  experimental_retryCleanup(args: { hostId: string }): Promise<{ ok: true }>;
  experimental_lifecycle(args: {
    hostId: string;
  }): Promise<experimental_HostLifecycleResponse>;
}

interface MachineCreateArgs {
  machineProviderId: string;
  inputs: JsonValue | null;
  key?: string;
  signal?: AbortSignal;
}

interface MachineLaunchStatus {
  id: string;
  phase: "creating" | "ready" | "failed" | "cancelled";
  hostId: string | null;
  step: string;
  log: string;
  message: string | null;
  cancelPending: boolean;
  terminal: boolean;
}

type experimental_HostLifecycleResponse = {
  phase: string;
  recoveryState: "healthy" | "draining" | "saving" | "saved" | "recoverable";
  message: string | null;
};

type SystemMachineProvider = {
  id: string;
  displayName: string;
  description: string;
  icon: string;
  machineTag: string | null;
  logoUrl: string | null;
  pluginId: string;
  inputs: JsonValue | null;
  acceptsEmptyInputs: boolean;
  supportsSuspend: boolean;
  availability: PluginMachineProviderAvailability | null;
};
```

`create` combines submit and follow. `submit` starts a durable launch; `follow` polls once per second and returns the host when ready, or throws for terminal failure/cancellation. Aborting follow stops waiting; explicit `cancel` requests cancellation of the launch.

`launch` defaults to exact launch lookup. `scope: "thread"` resolves a thread's current launch. `follow` itself does not expose a scope option.

`suspend` coordinates stopping active turns, setup hooks and terminals before the provider callback. A long-running terminal does not veto suspension. Follow-ups before the callback can cancel preparation; after callback entry, core finishes pause and resumes for queued work. `resume` restores the same host; it does not rerun checkout setup. Passive Git/PR reads do not automatically resume.

`delete` already existed; its behavior now also drives provider resource removal. `retryCleanup` retries failed cleanup. Missing compute can still leave removal blocked on host-local environment cleanup; there is no “remove anyway” API.

All new host methods are explicitly experimental. `experimental_listProviders` still accepts a project ID although standalone machine creation does not.

Source: [hosts SDK](packages/sdk/src/areas/hosts.ts).

## 10. Host and environment data contracts — breaking/expanded

Removed from Host:

```ts
type HostType = "persistent";
interface PreviousHostFields {
  type: HostType;
}
```

`HostType` / `hostTypeSchema` exports and the Host `type` field are removed. Added fields:

```ts
interface AddedHostFields {
  machineProviderId: string | null;
  machineProviderSelection: { inputs: JsonValue | null } | null;
  lifecycle: MachineLifecycle;
}

type MachineLifecycle = {
  phase: "active" | "suspending" | "suspended" | "removing" | "destroyed";
  suspendedAt: number | null;
  progress: string | null;
  teardown: {
    status: "running" | "failed" | "removed";
    attempt: number;
    message?: string;
  } | null;
};

type HostGetResult = Host & { connectMachineId: string | null };
```

Host connection status remains `connected | disconnected`; it is separate from lifecycle phase. `removing` represents explicit destructive removal. Removal retry timing is internal; the public lifecycle no longer exposes a retirement clock.

The environment-provider listing gains:

```ts
interface AddedSystemEnvironmentProviderFields {
  machineProviderId: string | null;
  environmentProviderId?: string;
}
```

Concrete providers have no composition target ID. Compositions expose their target so the client can resolve reusable inputs.

The existing `host-offline` queued-message state now also covers waiting during pause/resume. There is no extra public queue state. Existing provider event environment-source attribution also permits:

```ts
type EnvironmentValueSource =
  | "shell"
  | { plugin: string }
  | { core: "machine-git" | "machine-environment" };
```

Source: [Host](packages/domain/src/host.ts), [environment selection](packages/domain/src/environment.ts), [provider events](packages/domain/src/provider-event.ts).

## 11. Shared machine environment and server configuration — new SDK surfaces

```ts
interface SystemArea {
  machineEnvironment(): Promise<MachineEnvironmentList>;
  setMachineEnvironment(
    input: MachineEnvironmentSet,
  ): Promise<MachineEnvironmentList>;
  unsetMachineEnvironment(name: string): Promise<MachineEnvironmentList>;
}

type MachineEnvironmentSet = {
  name: string;
  value: string;
  note: string | null;
};

type MachineEnvironmentVariable = {
  name: string;
  value: null;
  secret: true;
  note: string | null;
};

type MachineEnvironmentList = {
  builtInGit: {
    status: "logged in" | "not logged in" | "overridden" | "disabled";
    statusMessage: string;
  };
  variables: MachineEnvironmentVariable[];
};
```

All stored values are encrypted in the DB; list/set responses never return them. The output retains `secret: true` even though the UI no longer has a secret toggle. Names match uppercase environment variable syntax, max 128 characters; values max 65,536 characters with no NUL; notes max 1,024. The route defaults omitted notes to null, but the inferred SDK input type above requires the nullable field.

New required fields in the existing AppSettings DTO:

```ts
interface AddedAppSettingsFields {
  machineServerUrl: string | null;
  defaultMachineAccess: string | null;
  machineGitCredentialsEnabled: boolean;
}
```

Defaults are null/null/true. Settings are changed through the existing settings API; they are not plugin setting descriptors. The existing system config response adds:

```ts
type ServerAccessStatus = {
  providers: {
    id: string;
    displayName: string;
    availability:
      | { status: "available"; serverUrl?: string }
      | { status: "setup-required"; message: string }
      | { status: "unavailable"; message: string };
  }[];
  defaultProviderId: string | null;
  effectiveUrl: string | null;
  urlSource: "setting" | "BB_EXTERNAL_URL" | null;
};

interface AddedSystemConfigFields {
  serverAccess: ServerAccessStatus;
}
```

Machine variables apply to new execution; GH_TOKEN can be supplied using server gh authentication, overridden by a user variable, or disabled. Existing plugin environment hooks remain inherited.

## 12. Existing branch APIs — behavior change

The component remains `experimental_BranchPicker` and its props type remains `BranchPickerProps`. Existing type imports keep working.

```ts
interface BranchPickerProps {
  hostId: string | null;

  projectId: string | null;

  value: string | null;

  onChange(next: string | null): void;

  label?: string;

  placeholder?: string;

  disabled?: boolean;
}

interface UseBranchesArgs {
  hostId: string | null;
  projectId: string | null;
  query?: string;
}

interface BranchesState {
  branches: readonly string[];
  remoteBranches: readonly string[];
  isLoading: boolean;
  refresh(): Promise<void>;
}
```

```ts
interface PluginSdkApp {
  experimental_BranchPicker: ComponentType<BranchPickerProps>;
  experimental_useBranches(args: UseBranchesArgs): BranchesState;
}
```

The hook's signature already existed. Its changed behavior: `hostId: null` now obtains branch suggestions from the project's default existing local source, or first local source. Project checkout's input component filters those suggestions to origin/\* for a new host. It does not query a not-yet-created machine. The BranchPicker component's own null-host behavior remains disabled, and checkout-state reads still require a host.

## 13. Testing API additions

New fields on existing testing interfaces:

```ts
interface CreateFakePluginHostOptions {
  machineBootstrap?: MachineBootstrapApi;
  machineResource?: (hostId: string) => Promise<JsonValue | null>;
}

interface FakePluginRegistrations {
  environmentCompositions: ReadonlyMap<
    string,
    NormalizedPluginEnvironmentComposition
  >;
  machineProviders: ReadonlyMap<string, NormalizedPluginMachineProvider>;
  serverAccessProviders: ReadonlyMap<string, ServerAccessProviderDeclaration>;
}

interface CapturedPluginApp {
  machineProviderInputs: PluginMachineProviderInputsRegistration[];
  machineSetup: ExperimentalMachineSetupRegistration[];
}
```

The fake host validates registrations, captures events, and uses injected bootstrap/resource implementations. Without bootstrap injection, enrollment/bootstrap calls fail explicitly. Normalized registration types are internal host-policy representations; they are not additional runtime namespaces.

Source: [fake host](packages/plugin-sdk/src/testing/fake-plugin-host.ts), [app harness](packages/plugin-sdk/src/testing/app.tsx).

## 14. Plugin-owned APIs versus shared SDK

Manual's command retrieval uses existing typed RPC registration, not a new generic SDK method. Its complete contract is:

```ts
const manualRpcContract = defineRpcContract({
  command: {
    input: z.object({ launchId: z.string().min(1) }).strict(),
    output: z.object({
      command: z.string().nullable(),
      expiresAt: z.number().nullable(),
    }),
  },
});
```

Modal's account, image and debug-sandbox commands are plugin implementations using existing CLI/tool facilities. They do not introduce a generic image catalogue, vendor observation or snapshot catalogue API. This inventory covers shared plugin/SDK contracts; plugin-specific command flags are documented in that plugin's own guide.

## 15. Things removed during this branch's development

These were intermediate PR designs, **not APIs removed from main**:

| Removed design                                                                    | Current replacement                                                         |
| --------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `PluginCliResult.experimental_continue`                                           | No continuation mechanism                                                   |
| `experimental_PluginRpcConflict` / `latestRevision`                               | Plugin-owned typed RPC results where needed                                 |
| `MachineExecutor.writeFile`                                                       | Executor exposes exec only                                                  |
| `prepareEnrollment` and top-level `waitForConnection` aliases                     | `enrollments.prepare` / `enrollments.waitForConnection`                     |
| Machine inputs `experimental_agentProviderId`                                     | No such prop                                                                |
| Provider `experimental_details`                                                   | Plugin-owned diagnostics                                                    |
| Machine `environmentRow`                                                          | Explicit environment composition registration                               |
| Core enrollment-command client in setup props                                     | Manual's own in-memory prepare result and RPC                               |
| Core machine idle policy / dynamic observations / retention / keep                | Plugin idle scheduling and coordinated core suspend/resume                  |
| Machine readiness/preflight/fingerprint APIs and automatic agent CLI installation | No such public machine capability; normal execution reports actual failures |
| Project-scoped machine create fields / CLI --project                              | Project-independent machine creation                                        |
| `experimental_reconcileCleanup` spelling                                          | Required `reconcileCleanup` callback                                        |
| Per-variable plaintext/secret choice                                              | Always-encrypted machine variables                                          |

## 16. Review decisions and remaining questions

Applied:

- Machine provider description and icon are required.
- Resource lookup is `bb.experimental_machines.getResource`; the redundant experimental prefix is removed.
- All newly added host SDK methods use `experimental_`.
- Create, suspend and resume checkpoints all return `Promise<void>`; providers await them.
- Machine lifecycle uses `removing`, with no public `retireAt`. Removal retry scheduling is internal.
- SDK package and core version both advertise 0.4.71.

Machine input props and provider listing no longer carry project context. Connect uses existing plugin KV; shared machine variables use encrypted DB storage. A disconnected active host does not become paused solely because its provider supports resume.

Still open:

1. Review whether the new-host target contract needs any further work; no additional opt-in is implemented.
2. Server-access recovery still uses an Error.name string. Review whether ordinary failure handling is sufficient.

Cleanup callbacks remain required. Manual allocates no compute, so reconciliation immediately returns removed. Its remove callback reports the manual uninstall command and returns removed; core handles detaching the host. Optional cleanup has not been introduced.

The two machine UI slots serve different scopes: inputs supplies a control within core's creation form; setup owns the full provider-specific dialog. Manual uses setup for its command and countdown.

Connect keeps one KV record per machine: a pending redemption or a completed grant. Legacy migrations, quarantine diagnostics, and the attention callback are removed. Credentials stay outside the configuration UI.
