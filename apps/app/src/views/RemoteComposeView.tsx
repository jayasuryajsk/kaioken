import {
  pendingWorkspaceDraft,
  acknowledgeWorkspaceDraft,
} from "@/lib/federation/workspace-drafts";
import { readConnectionIdentity } from "@/lib/federation/connection-identities";
import { useRemotePromptDraft } from "@/hooks/useRemotePromptDraft";
import { promptDraftToInput } from "@kaioken/client-core";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import type { PermissionMode, ReasoningLevel } from "@kaioken/domain";
import { PERSONAL_PROJECT_ID, permissionModeRank } from "@kaioken/domain";
import {
  EMPTY_ORDERED_MENTION_SUGGESTIONS,
  PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
  PERSONAL_WORKSPACE_ENVIRONMENT_PROVIDER_ID,
  type FederatedServer,
  type FollowUpSubmitMode,
} from "@kaioken/client-core";
import type { ProjectWithThreadsResponse } from "@kaioken/server-contract";
import { Icon } from "@kaioken/shared-ui/icon";
import { MachineStatusDot } from "@/components/machines/MachineStatusDot";
import { MachinePickerUI } from "@/components/pickers/MachinePicker";
import type { ProviderPickerOption } from "@/components/pickers/model-brand-prefix";
import {
  FollowUpPromptBox,
  type FollowUpComposerProps,
} from "@/components/promptbox/FollowUpPromptBox";
import type {
  ExecutionControlsProps,
  ExecutionPermissionConfig,
} from "@/components/promptbox/ExecutionControls";
import {
  INERT_TYPEAHEAD_COMMAND_CONFIG,
  type TypeaheadConfig,
} from "@/components/promptbox/PromptBoxInternal";
import {
  formatOfflineMeta,
  useNow,
} from "@/components/sidebar/TimelineThreadList";
import { PageShell } from "@/components/ui/page-shell.js";
import { useCreateRemoteThread } from "@/hooks/mutations/remote-thread-mutations";
import { useFederatedRemotes } from "@/hooks/queries/federation-queries";
import {
  useRemoteComposeOptions,
  useRemoteHosts,
} from "@/hooks/queries/remote-compose-queries";
import { selectPersistentHosts } from "@/hooks/queries/host-queries";
import { resolveModelCatalogSelection } from "@/hooks/thread-creation-options/model-catalog-selection";
import {
  formatModelLabel,
  resolvePermissionModeSelection,
} from "@/hooks/thread-creation-options/selection-state";
import { PERMISSION_MODE_OPTIONS } from "@/lib/permission-mode-options";
import { getProviderIconInfo } from "@/lib/provider-icon";
import {
  getRemoteProjectComposeRoutePath,
  getRemoteThreadRoutePath,
} from "@/lib/route-paths";
import { Button } from "@kaioken/shared-ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kaioken/shared-ui/dropdown-menu";
import { deriveProjectNameFromPath } from "@kaioken/domain";
import {
  ProjectPathDialog,
  type ProjectPathDialogTarget,
} from "@/components/dialogs/ProjectPathDialog";
import { useCreateRemoteProject } from "@/hooks/mutations/remote-project-mutations";
import { getRemoteSdk } from "@/lib/federation/remote-sdk";

const REMOTE_TYPEAHEAD: TypeaheadConfig = {
  mention: {
    results: EMPTY_ORDERED_MENTION_SUGGESTIONS,
    isLoading: false,
    isError: false,
    onQueryChange: () => {},
  },
  command: INERT_TYPEAHEAD_COMMAND_CONFIG,
};

const DEFAULT_PERMISSION_MODES: readonly PermissionMode[] = [
  "accept-edits",
  "auto",
  "full",
];

export function remoteComposeTitle(projectName: string, serverName: string) {
  return `New thread in ${projectName} on ${serverName}`;
}

function findRemoteProject(
  projects: readonly ProjectWithThreadsResponse[],
  personalProject: ProjectWithThreadsResponse | null,
  projectId: string,
): ProjectWithThreadsResponse | null {
  if (personalProject !== null && personalProject.id === projectId) {
    return personalProject;
  }
  return projects.find((project) => project.id === projectId) ?? null;
}

function projectHostId(project: ProjectWithThreadsResponse): string | null {
  const source = project.sources.find(
    (candidate) => candidate.type === "local_path",
  );
  return source?.hostId ?? null;
}

interface RemoteComposerProps {
  server: FederatedServer;
  project: ProjectWithThreadsResponse;
}

function RemoteComposer({ server, project }: RemoteComposerProps) {
  const navigate = useNavigate();
  const hostsQuery = useRemoteHosts(server);
  const hosts = useMemo(
    () => selectPersistentHosts(hostsQuery.data ?? []),
    [hostsQuery.data],
  );
  const checkoutHostId = projectHostId(project);
  const [chosenHostId, setChosenHostId] = useState<string | null>(null);
  const hostId =
    chosenHostId ??
    (hosts.some((host) => host.id === checkoutHostId)
      ? checkoutHostId
      : (hosts[0]?.id ?? null));
  const defaults = project.defaultExecutionOptions;
  const [chosenProviderId, setChosenProviderId] = useState<string | null>(null);
  const [modelChoice, setModelChoice] = useState<{
    providerId: string;
    model: string;
  } | null>(null);
  const [reasoningChoice, setReasoningChoice] = useState<{
    providerId: string;
    level: ReasoningLevel;
  } | null>(null);
  const [chosenPermission, setChosenPermission] =
    useState<PermissionMode | null>(null);
  const providerQuery = useRemoteComposeOptions(server, hostId, null);
  const providers = useMemo(
    () =>
      [...(providerQuery.data?.providers ?? [])].sort(
        (left, right) => Number(right.available) - Number(left.available),
      ),
    [providerQuery.data?.providers],
  );
  const providerId =
    chosenProviderId !== null &&
    providers.some((provider) => provider.id === chosenProviderId)
      ? chosenProviderId
      : providers.some((provider) => provider.id === defaults?.providerId)
        ? (defaults?.providerId ?? "")
        : (providers[0]?.id ?? "");
  const optionsQuery = useRemoteComposeOptions(
    server,
    hostId,
    providerId.length > 0 ? providerId : null,
  );
  const providerInfo = providers.find((provider) => provider.id === providerId);
  const chosenModel =
    modelChoice?.providerId === providerId ? modelChoice.model : null;
  const chosenReasoning =
    reasoningChoice?.providerId === providerId ? reasoningChoice.level : null;
  const setChosenModel = useCallback(
    (model: string) => setModelChoice({ providerId, model }),
    [providerId],
  );
  const setChosenReasoning = useCallback(
    (level: ReasoningLevel) => setReasoningChoice({ providerId, level }),
    [providerId],
  );
  const catalog = useMemo(
    () =>
      resolveModelCatalogSelection({
        models: optionsQuery.data?.models ?? [],
        selectedOnlyModels: optionsQuery.data?.selectedOnlyModels ?? [],
        selectedModel:
          chosenModel ??
          (defaults?.providerId === providerId ? defaults.model : ""),
        preferredReasoningLevel:
          chosenReasoning ??
          (defaults?.providerId === providerId
            ? defaults.reasoningLevel
            : undefined),
        provider: providerInfo,
        catalogIsVerified:
          optionsQuery.data !== undefined &&
          !optionsQuery.isPlaceholderData &&
          !optionsQuery.isError,
        formatModelLabel,
      }),
    [
      chosenModel,
      chosenReasoning,
      defaults,
      optionsQuery.data,
      optionsQuery.isError,
      optionsQuery.isPlaceholderData,
      providerId,
      providerInfo,
    ],
  );
  const permissionModes =
    providerInfo?.capabilities.permissionModes ?? DEFAULT_PERMISSION_MODES;
  const permissionCeiling = optionsQuery.data?.permissionCeiling ?? "full";
  const allowedPermissionModes = useMemo(
    () =>
      permissionModes.filter(
        (mode) =>
          permissionModeRank(mode) <= permissionModeRank(permissionCeiling),
      ),
    [permissionCeiling, permissionModes],
  );
  const permissionMode = resolvePermissionModeSelection({
    rawPermissionMode:
      chosenPermission ?? defaults?.permissionMode ?? "accept-edits",
    permissionModes:
      allowedPermissionModes.length > 0
        ? allowedPermissionModes
        : permissionModes,
  });
  const providerOptions = useMemo(
    (): ProviderPickerOption[] =>
      providers.map((provider) => ({
        value: provider.id,
        label: provider.displayName,
        icon: getProviderIconInfo(provider.id, provider)?.icon,
        ...(provider.strings?.brandPrefix === undefined
          ? {}
          : { brandPrefix: provider.strings.brandPrefix }),
        ...(provider.strings?.planModeCopy === undefined
          ? {}
          : { planModeCopy: provider.strings.planModeCopy }),
      })),
    [providers],
  );
  const execution = useMemo<ExecutionControlsProps>(
    () => ({
      provider: {
        options: providerOptions,
        selectedId: providerId,
        onChange: setChosenProviderId,
        hasMultiple: providerOptions.length > 1,
      },
      model: {
        active: catalog.activeModel
          ? { model: catalog.activeModel.model }
          : null,
        selected: catalog.selectedModel,
        options: catalog.modelOptions,
        moreOptions: catalog.moreModelOptions,
        isLoading: optionsQuery.isPending,
        loadFailed:
          optionsQuery.isError || optionsQuery.data?.modelLoadError != null,
        loadError: optionsQuery.data?.modelLoadError ?? null,
        onChange: setChosenModel,
      },
      reasoning: {
        value: catalog.reasoningLevel,
        options: catalog.reasoningOptions,
        onChange: setChosenReasoning,
      },
    }),
    [
      catalog,
      optionsQuery,
      providerId,
      providerOptions,
      setChosenModel,
      setChosenReasoning,
    ],
  );
  const permission = useMemo<ExecutionPermissionConfig>(
    () => ({
      value: permissionMode,
      options: PERMISSION_MODE_OPTIONS.filter((option) =>
        permissionModes.includes(option.value),
      ).map((option) =>
        permissionModeRank(option.value) > permissionModeRank(permissionCeiling)
          ? { ...option, disabled: true }
          : option,
      ),
      onChange: setChosenPermission,
      supported: permissionModes.length > 1,
    }),
    [permissionCeiling, permissionMode, permissionModes],
  );

  const { draft, attachments } = useRemotePromptDraft(
    server,
    project.id,
    `project:${project.id}`,
  );
  const message = draft.text;
  const mentionRanges = draft.mentions;
  const location = useLocation();
  useEffect(() => {
    const serverId = readConnectionIdentity(
      new URL(server.url).origin,
      server.handle,
    );
    if (!serverId) return;
    const transferred = pendingWorkspaceDraft(
      server.handle,
      serverId,
      `${location.pathname}${location.search}`,
    );
    if (!transferred) return;
    draft.setDraft({
      text: transferred.text,
      mentions: [],
      attachments: transferred.attachments,
    });
    acknowledgeWorkspaceDraft(server.handle, serverId, transferred.id);
  }, [draft, location.pathname, location.search, server.handle, server.url]);
  const create = useCreateRemoteThread(server);
  const model = catalog.activeModel?.model ?? catalog.selectedModel;
  const canSubmit =
    server.live &&
    !attachments.isAttaching &&
    !optionsQuery.isError &&
    !hostsQuery.isError &&
    hostId !== null &&
    providerId.length > 0 &&
    model.length > 0 &&
    !create.isPending;
  const submit = useCallback(() => {
    const text = message.trim();
    if (
      (text.length === 0 && draft.attachments.length === 0) ||
      !canSubmit ||
      hostId === null
    )
      return;
    const submitted = draft.getCurrent();
    create.mutate(
      {
        projectId: project.id,
        providerId,
        model,
        reasoningLevel: catalog.reasoningLevel,
        permissionMode,
        input: promptDraftToInput(submitted),
        environment: {
          type: "provider",
          environmentProviderId:
            project.id === PERSONAL_PROJECT_ID
              ? PERSONAL_WORKSPACE_ENVIRONMENT_PROVIDER_ID
              : PROJECT_CHECKOUT_ENVIRONMENT_PROVIDER_ID,
          machine: { type: "existing", hostId },
          inputs: null,
        },
      },
      {
        onSuccess: (thread) => {
          draft.clearIfCurrentMatches(submitted);
          navigate(
            getRemoteThreadRoutePath({
              handle: server.handle,
              threadId: thread.id,
            }),
          );
        },
      },
    );
  }, [
    canSubmit,
    draft,
    catalog.reasoningLevel,
    create,
    hostId,
    message,
    model,
    navigate,
    permissionMode,
    project.id,
    providerId,
    server.handle,
  ]);
  const submitMode = useMemo<FollowUpSubmitMode>(() => {
    if (!server.live) return { kind: "blocked", reason: "unavailable" };
    if (optionsQuery.isPending) {
      return { kind: "blocked", reason: "loading-execution-options" };
    }
    if (!canSubmit && !create.isPending) {
      return { kind: "blocked", reason: "unavailable" };
    }
    return { kind: "ready" };
  }, [canSubmit, create.isPending, optionsQuery.isPending, server.live]);
  const composer = useMemo<FollowUpComposerProps>(
    () => ({
      history: {
        currentDraft: draft.getCurrent(),
        entries: [],
        onSelectEntry: () => {},
      },
      isFollowUpSubmitting: create.isPending,
      message,
      mentionRanges,
      onChangeMessage: (value, ranges) => {
        draft.setTextAndMentions(value, ranges);
      },
      onSubmit: submit,
      onModifierSubmit: submit,
      submitTitle: `Start on ${server.name}`,
      compactPromptPlaceholder: `New thread on ${server.name}`,
      promptPlaceholder: `Start a thread in ${project.name} on ${server.name}`,
      canModifierSubmit: false,
      steerActiveThreadOnEnter: false,
      submitMode,
      threadRuntimeDisplayStatus: "idle",
    }),
    [
      create.isPending,
      draft,
      mentionRanges,
      message,
      project.name,
      server.name,
      submit,
      submitMode,
    ],
  );

  return (
    <div
      data-testid="remote-compose"
      data-server={server.handle}
      className="flex flex-col gap-2"
    >
      <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground">
        <span>Runs on</span>
        <MachinePickerUI
          hosts={hosts}
          localDaemonHostId={null}
          primaryHostId={checkoutHostId}
          selectedHostId={hostId}
          onChange={setChosenHostId}
          disabled={hosts.length === 0}
        />
        {hostsQuery.isError ? (
          <span data-testid="remote-compose-hosts-error">
            Could not list machines on {server.name}.
          </span>
        ) : null}
      </div>
      <FollowUpPromptBox
        attachments={attachments}
        stack={null}
        composer={composer}
        environmentSummary={null}
        contextWindowUsage={null}
        execution={execution}
        permission={permission}
        typeahead={REMOTE_TYPEAHEAD}
        suppressPluginComposerCustomizations
        collapseResetKey={`${server.handle}:${project.id}`}
        isPrimaryComposer
      />
    </div>
  );
}

interface RemoteProjectSwitcherProps {
  server: FederatedServer;
  projects: readonly ProjectWithThreadsResponse[];
  personalProject: ProjectWithThreadsResponse | null;
  currentProject: ProjectWithThreadsResponse | null;
}

function RemoteProjectSwitcher({
  server,
  projects,
  personalProject,
  currentProject,
}: RemoteProjectSwitcherProps) {
  const navigate = useNavigate();
  const hostsQuery = useRemoteHosts(server);
  const hosts = useMemo(
    () => selectPersistentHosts(hostsQuery.data ?? []),
    [hostsQuery.data],
  );
  const [target, setTarget] = useState<ProjectPathDialogTarget | null>(null);
  const create = useCreateRemoteProject(server);
  const remoteSdk = useMemo(() => getRemoteSdk(server.url), [server.url]);
  const defaultHostId =
    (currentProject === null ? null : projectHostId(currentProject)) ??
    hosts[0]?.id ??
    null;
  const options = [
    ...(personalProject === null ? [] : [personalProject]),
    ...projects.filter((project) => project.id !== personalProject?.id),
  ];
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 px-2">
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="outline"
            size="sm"
            data-testid="remote-project-switcher"
            className="gap-1"
          >
            <Icon name="Folder" className="size-3.5" />
            {currentProject?.name ?? "Choose a project"}
            <Icon name="ChevronDown" className="size-3.5 opacity-70" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
          {options.map((project) => (
            <DropdownMenuItem
              key={project.id}
              onSelect={() =>
                navigate(
                  getRemoteProjectComposeRoutePath({
                    handle: server.handle,
                    projectId: project.id,
                  }),
                )
              }
            >
              {project.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        data-testid="remote-new-project"
        disabled={!server.live || create.isPending}
        onClick={() => setTarget({ kind: "create" })}
      >
        <Icon name="Plus" className="size-3.5" />
        New project on {server.name}
      </Button>
      <ProjectPathDialog
        target={target}
        pending={create.isPending}
        platform={null}
        hostId={defaultHostId}
        hostName={hosts.find((host) => host.id === defaultHostId)?.name ?? null}
        hosts={hosts}
        sdk={remoteSdk}
        cacheScope={server.handle}
        onOpenChange={(open) => {
          if (!open) setTarget(null);
        }}
        onSubmit={(submitted, path, hostId) => {
          if (submitted.kind !== "create" || hostId === null) return;
          const name = deriveProjectNameFromPath(path).trim();
          if (name.length === 0) return;
          create.mutate(
            { name, source: { type: "local_path", hostId, path } },
            {
              onSuccess: (project) => {
                setTarget(null);
                navigate(
                  getRemoteProjectComposeRoutePath({
                    handle: server.handle,
                    projectId: project.id,
                  }),
                );
              },
            },
          );
        }}
      />
    </div>
  );
}

export function RemoteComposeView() {
  const params = useParams<{ handle: string; projectId: string }>();
  const handle = params.handle ?? "";
  const projectId = params.projectId ?? "";
  const now = useNow();
  const { servers, remotes } = useFederatedRemotes();
  const server = servers.find((candidate) => candidate.handle === handle);
  const snapshot = remotes.find((remote) => remote.server.handle === handle);
  const project = useMemo(
    () =>
      snapshot?.bootstrap === null || snapshot === undefined
        ? null
        : findRemoteProject(
            snapshot.bootstrap.projects,
            snapshot.bootstrap.personalProject,
            projectId,
          ),
    [projectId, snapshot],
  );

  if (server === undefined) {
    return (
      <PageShell>
        <p
          data-testid="remote-compose-unknown-server"
          className="px-2 py-4 text-sm text-muted-foreground"
        >
          {servers.length === 0
            ? "Looking up this Kaioken…"
            : `No Kaioken with the handle "${handle}" is on this account.`}
        </p>
      </PageShell>
    );
  }

  const switcher =
    snapshot?.bootstrap === null || snapshot === undefined ? null : (
      <RemoteProjectSwitcher
        server={server}
        projects={snapshot.bootstrap.projects}
        personalProject={snapshot.bootstrap.personalProject}
        currentProject={project}
      />
    );
  const header = (
    <div className="mb-3 flex min-w-0 items-center gap-2 px-2">
      <h1
        data-testid="remote-compose-title"
        className="min-w-0 flex-1 truncate text-base font-semibold text-foreground"
      >
        {project === null
          ? `New thread on ${server.name}`
          : remoteComposeTitle(project.name, server.name)}
      </h1>
      <span
        data-testid="remote-compose-marker"
        className="flex shrink-0 items-center gap-1.5 rounded-full border border-border bg-surface-recessed px-2 py-0.5 text-xs text-muted-foreground"
        title={
          server.live ? server.name : formatOfflineMeta(server.lastSeenAt, now)
        }
      >
        <MachineStatusDot connected={server.live} />
        <Icon name="ComputerTerminal01" className="size-3" />
        On {server.name}
      </span>
    </div>
  );

  if (!server.live) {
    return (
      <PageShell>
        {header}
        <p className="px-2 py-4 text-sm text-muted-foreground">
          {server.name} is offline · {formatOfflineMeta(server.lastSeenAt, now)}
          . New threads will work when it is back.
        </p>
      </PageShell>
    );
  }

  if (project === null) {
    return (
      <PageShell>
        {header}
        {switcher}
        <p
          data-testid="remote-compose-unknown-project"
          className="px-2 py-4 text-sm text-muted-foreground"
        >
          {snapshot?.status === "loading"
            ? `Loading projects from ${server.name}…`
            : `${server.name} has no project "${projectId}".`}
        </p>
      </PageShell>
    );
  }

  return (
    <PageShell
      footer={
        <RemoteComposer
          key={`${server.handle}:${project.id}`}
          server={server}
          project={project}
        />
      }
    >
      {header}
      {switcher}
      <p className="px-2 text-sm text-muted-foreground">
        The thread is created and runs on {server.name}. You can follow and
        reply to it from here.
      </p>
    </PageShell>
  );
}
