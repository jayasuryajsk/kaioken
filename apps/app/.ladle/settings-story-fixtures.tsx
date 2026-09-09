import { useState, type ReactNode } from "react";
import { useNavigate } from "react-router-dom";
import { QueryClientProvider } from "@tanstack/react-query";
import { PERSONAL_PROJECT_ID, type ProviderInfo } from "@bb/domain";
import { UPDATE_ACTION_ICON } from "@bb/domain/update-state";
import type {
  SidebarBootstrapResponse,
  SystemVersionResponse,
} from "@bb/server-contract";
import type { ProviderCliStatusResponse } from "@bb/host-daemon-contract";
import {
  hostProviderCliStatusQueryKey,
  hostsQueryKey,
  pluginListQueryKey,
  pluginMarketplacesQueryKey,
  sidebarNavigationQueryKey,
  systemConfigQueryKey,
  systemProvidersQueryKey,
  systemVersionQueryKey,
} from "../src/hooks/queries/query-keys";
import {
  buildUpdateInventoryProviderIssues,
  type UpdateInventoryMachine,
} from "../src/hooks/useUpdateInventory";
import { createAppQueryClient } from "../src/lib/query-client";
import { makeSystemConfig } from "../src/test/fixtures/system-config";
import { systemMachineProvidersQueryKey } from "../src/hooks/queries/machine-provider-queries";
import { machineLifecycleQueryKey } from "../src/components/machines/MachineLifecycleNotice";
import {
  MANUAL_MACHINE_PROVIDER,
  MODAL_MACHINE_PROVIDER,
} from "./machine-story-fixtures";
import { makeProviderInfo } from "@bb/test-helpers/domain-fixtures";
import { getSettingsRoutePath } from "../src/lib/route-paths";
import {
  BbAppUpdateRows,
  MachineUpdatesFleetSection,
  MachineUpdatesRows,
  MachineUpdatesSection,
  UpdateActionButton,
} from "../src/components/settings/UpdatesSettingsSection";
import {
  HOST_IDS,
  HOST_NAMES,
  PROJECT_IDS,
  PROJECT_NAMES,
  STORY_PROJECT_SOURCES,
  makeHost,
  makeProject,
  makeThreadListEntry,
  makeProviderCliStatus,
} from "./story-fixtures";
import codexLogoUrl from "../../../plugins/provider-codex/icons/codex.svg";
import claudeCodeLogoUrl from "../../../plugins/provider-claude-code/icons/claude-code.svg";
import cursorLogoUrl from "../../../plugins/provider-acp/icons/cursor.svg";

const SETTINGS_STORY_NOW = Date.parse("2026-08-19T08:00:00.000Z");

const SETTINGS_STORY_PRIMARY_HOST = makeHost({
  createdAt: SETTINGS_STORY_NOW - 45 * 24 * 60 * 60_000,
  lastSeenAt: SETTINGS_STORY_NOW,
});

const PAUSED_MACHINE_ID = "host_story_paused";
const PAUSING_MACHINE_ID = "host_story_pausing";
const RETIRING_MACHINE_ID = "host_story_retiring";
const CLEANUP_FAILED_MACHINE_ID = "host_story_cleanup_failed";

const SETTINGS_STORY_HOSTS = [
  SETTINGS_STORY_PRIMARY_HOST,
  makeHost({
    id: HOST_IDS.remote,
    name: HOST_NAMES.remote,
    maxPermissionMode: "auto",
    createdAt: SETTINGS_STORY_NOW - 18 * 24 * 60 * 60_000,
    lastSeenAt: SETTINGS_STORY_NOW - 3 * 60_000,
  }),
  makeHost({
    id: PAUSED_MACHINE_ID,
    name: "Modal sandbox 3f9a",
    status: "disconnected",
    machineProviderId: MODAL_MACHINE_PROVIDER.id,
    createdAt: SETTINGS_STORY_NOW - 4 * 60 * 60_000,
    lastSeenAt: SETTINGS_STORY_NOW - 26 * 60_000,
    lifecycle: {
      phase: "suspended",
      suspendedAt: SETTINGS_STORY_NOW - 25 * 60_000,
      retireAt: null,
      progress: null,
      teardown: null,
    },
  }),
  makeHost({
    id: PAUSING_MACHINE_ID,
    name: "Modal sandbox 91c4",
    machineProviderId: MODAL_MACHINE_PROVIDER.id,
    createdAt: SETTINGS_STORY_NOW - 90 * 60_000,
    lastSeenAt: SETTINGS_STORY_NOW - 30_000,
    lifecycle: {
      phase: "suspending",
      suspendedAt: null,
      retireAt: null,
      progress: "Saving the sandbox filesystem",
      teardown: null,
    },
  }),
  makeHost({
    id: RETIRING_MACHINE_ID,
    name: "Modal sandbox 0af2",
    machineProviderId: MODAL_MACHINE_PROVIDER.id,
    createdAt: SETTINGS_STORY_NOW - 3 * 24 * 60 * 60_000,
    lastSeenAt: SETTINGS_STORY_NOW - 2 * 60_000,
    lifecycle: {
      phase: "retiring",
      suspendedAt: null,
      retireAt: SETTINGS_STORY_NOW + 5 * 60_000,
      progress: null,
      teardown: { status: "running", attempt: 1 },
    },
  }),
  makeHost({
    id: CLEANUP_FAILED_MACHINE_ID,
    name: "Modal sandbox 55de",
    status: "disconnected",
    machineProviderId: MODAL_MACHINE_PROVIDER.id,
    createdAt: SETTINGS_STORY_NOW - 6 * 24 * 60 * 60_000,
    lastSeenAt: SETTINGS_STORY_NOW - 3 * 60 * 60_000,
    lifecycle: {
      phase: "retiring",
      suspendedAt: null,
      retireAt: SETTINGS_STORY_NOW - 60 * 60_000,
      progress: null,
      teardown: {
        status: "failed",
        attempt: 3,
        message: "Modal refused to delete the sandbox",
      },
    },
  }),
];

const localProviderStatus = {
  codex: makeProviderCliStatus("codex", {
    currentVersion: "0.145.0",
    latestVersion: "0.146.0",
    needsUpdate: true,
    installAction: {
      kind: "update",
      label: "Update",
      command: "codex update",
    },
  }),
  "claude-code": makeProviderCliStatus("claude-code", {
    currentVersion: "2.1.0",
    latestVersion: "2.1.0",
  }),
  "acp-cursor": makeProviderCliStatus("acp-cursor", {
    currentVersion: "0.49.0",
    latestVersion: "0.49.0",
  }),
} satisfies ProviderCliStatusResponse;

const remoteProviderStatus = {
  codex: makeProviderCliStatus("codex", {
    currentVersion: "0.145.0",
    latestVersion: "0.146.0",
    needsUpdate: true,
    installAction: {
      kind: "update",
      label: "Update",
      command: "codex update",
    },
  }),
  "claude-code": makeProviderCliStatus("claude-code", {
    currentVersion: "2.1.0",
    latestVersion: "2.1.0",
  }),
  "acp-cursor": makeProviderCliStatus("acp-cursor", {
    installed: false,
    executablePath: null,
    currentVersion: null,
    latestVersion: "0.49.0",
    installSource: undefined,
  }),
} satisfies ProviderCliStatusResponse;

const project = makeProject({
  id: PROJECT_IDS.bb,
  gitRemoteUrl: "git@github.com:get-bb/bb.git",
  sources: [...STORY_PROJECT_SOURCES],
});
const pierreProject = makeProject({
  id: PROJECT_IDS.pierre,
  name: PROJECT_NAMES.pierre,
  gitRemoteUrl: "https://github.com/get-bb/pierre.git",
  sources: [
    {
      id: "src_pierre_remote",
      projectId: PROJECT_IDS.pierre,
      type: "local_path",
      hostId: HOST_IDS.remote,
      path: "/home/michael/pierre",
      isDefault: true,
      createdAt: 0,
      updatedAt: 0,
    },
  ],
});
const ingestProject = makeProject({
  id: PROJECT_IDS.ingest,
  name: PROJECT_NAMES.ingest,
  gitRemoteUrl: null,
  sources: [],
});
const personalProject = makeProject({
  id: PERSONAL_PROJECT_ID,
  kind: "personal",
  name: "Personal",
  sources: [],
});

const sidebarNavigation = {
  sections: [],
  projects: [
    {
      ...project,
      defaultExecutionOptions: null,
      threads: [
        makeThreadListEntry({ id: "thr_bb_1", projectId: PROJECT_IDS.bb }),
        makeThreadListEntry({ id: "thr_bb_2", projectId: PROJECT_IDS.bb }),
        makeThreadListEntry({ id: "thr_bb_3", projectId: PROJECT_IDS.bb }),
      ],
    },
    {
      ...pierreProject,
      defaultExecutionOptions: null,
      threads: [
        makeThreadListEntry({
          id: "thr_pierre_1",
          projectId: PROJECT_IDS.pierre,
        }),
      ],
    },
    { ...ingestProject, defaultExecutionOptions: null, threads: [] },
  ],
  personalProject: {
    ...personalProject,
    defaultExecutionOptions: null,
    threads: [],
  },
} satisfies SidebarBootstrapResponse;

const systemConfig = makeSystemConfig({
  primaryHostId: HOST_IDS.local,
  primaryHostPlatform: "darwin",
  voiceTranscriptionEnabled: true,
  dataDir: "/Users/michael/.bb",
});

const systemVersion = {
  currentVersion: "0.39.0",
  latestVersion: "0.39.0",
  source: "npm",
  updateAvailable: false,
  isDevelopment: false,
  upgradeCommand: "npx bb-app@latest",
} satisfies SystemVersionResponse;

const systemProviders = [
  makeProviderInfo({
    id: "codex",
    displayName: "Codex",
    logoUrl: codexLogoUrl,
  }),
  makeProviderInfo({
    id: "claude-code",
    displayName: "Claude Code",
    logoUrl: claudeCodeLogoUrl,
  }),
  makeProviderInfo({
    id: "acp-cursor",
    displayName: "Cursor",
    logoUrl: cursorLogoUrl,
  }),
] satisfies ProviderInfo[];

const settingsUpdateMachine = {
  host: SETTINGS_STORY_PRIMARY_HOST,
  isPrimary: true,
  providerStatus: localProviderStatus,
  statusPending: false,
  statusError: false,
  statusFetching: false,
  issues: buildUpdateInventoryProviderIssues(localProviderStatus),
  canRetryDaemonUpdate: false,
} satisfies UpdateInventoryMachine;

const noJobs: ReadonlySet<string> = new Set();
const noop = () => {};

export function SettingsUpdatesStory() {
  const navigate = useNavigate();
  return (
    <MachineUpdatesFleetSection
      action={
        <div role="toolbar" aria-label="Bulk update actions">
          <UpdateActionButton
            label="Update all 1 CLI tool"
            tooltipLabel="Update all"
            icon={UPDATE_ACTION_ICON}
            visibleLabel="Update all"
            variant="default"
            onClick={noop}
          />
        </div>
      }
    >
      <MachineUpdatesSection
        machine={settingsUpdateMachine}
        isThisMachine={false}
      >
        <BbAppUpdateRows
          systemVersion={systemVersion}
          desktopInfo={null}
          isDesktop={false}
          onRelaunchDesktop={null}
          onRetryDesktop={null}
        />
        <MachineUpdatesRows
          machine={settingsUpdateMachine}
          runningJobKey={null}
          queuedJobKeys={noJobs}
          onStartInstall={noop}
          onOpenProvider={() => navigate(getSettingsRoutePath("providers"))}
        />
      </MachineUpdatesSection>
    </MachineUpdatesFleetSection>
  );
}

function createSettingsStoryQueryClient() {
  const queryClient = createAppQueryClient({
    showMutationErrorToasts: false,
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        gcTime: Infinity,
        retry: false,
        staleTime: Infinity,
      },
    },
  });
  queryClient.setQueryData(hostsQueryKey(), SETTINGS_STORY_HOSTS);
  queryClient.setQueryData(systemConfigQueryKey(), systemConfig);
  queryClient.setQueryData(systemProvidersQueryKey(), systemProviders);
  queryClient.setQueryData(systemVersionQueryKey(), systemVersion);
  queryClient.setQueryData(sidebarNavigationQueryKey(), sidebarNavigation);
  queryClient.setQueryData(pluginMarketplacesQueryKey(), []);
  queryClient.setQueryData(
    hostProviderCliStatusQueryKey(HOST_IDS.local),
    localProviderStatus,
  );
  queryClient.setQueryData(
    hostProviderCliStatusQueryKey(HOST_IDS.remote),
    remoteProviderStatus,
  );
  queryClient.setQueryData(pluginListQueryKey(true), []);
  queryClient.setQueryData(systemMachineProvidersQueryKey(), [
    MANUAL_MACHINE_PROVIDER,
    MODAL_MACHINE_PROVIDER,
  ]);
  for (const hostId of [
    PAUSED_MACHINE_ID,
    PAUSING_MACHINE_ID,
    RETIRING_MACHINE_ID,
  ]) {
    queryClient.setQueryData(machineLifecycleQueryKey(hostId), {
      phase: "active",
      recoveryState: "healthy",
      message: null,
    });
  }
  queryClient.setQueryData(
    machineLifecycleQueryKey(CLEANUP_FAILED_MACHINE_ID),
    {
      phase: "retiring",
      recoveryState: "recoverable",
      message:
        "Modal refused to delete the sandbox after 3 attempts. Removing the machine here clears it from bb; delete the sandbox in Modal too.",
    },
  );
  return queryClient;
}

export function SettingsStoryFixtures({ children }: { children: ReactNode }) {
  const [queryClient] = useState(createSettingsStoryQueryClient);
  return (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}
