import { useState, type ReactNode } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type {
  ServerAccessStatus,
  SystemMachineProvider,
} from "@bb/server-contract";
import { CreateMachineContent } from "./CreateMachineDialog";
import { createAppQueryClient } from "@/lib/query-client";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { systemMachineProvidersQueryKey } from "@/hooks/queries/machine-provider-queries";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Add a Machine",
};

const noop = () => {};

const CONNECT_UNPAIRED: ServerAccessStatus = {
  providers: [
    {
      id: "connect",
      displayName: "bb connect",
      attention: null,
      availability: {
        status: "setup-required",
        message: "Pair this bb instance with bb connect",
      },
    },
    {
      id: "direct",
      displayName: "Manual",
      attention: null,
      availability: { status: "available" },
    },
  ],
  defaultProviderId: "connect",
  effectiveUrl: null,
  urlSource: null,
};

const CONNECT_PAIRED: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  providers: [
    {
      id: "connect",
      displayName: "bb connect",
      attention: null,
      availability: {
        status: "available",
        serverUrl: "https://sawyer.getbb.app",
      },
    },
    CONNECT_UNPAIRED.providers[1]!,
  ],
};

const CONNECT_UNAVAILABLE: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  providers: [
    {
      id: "connect",
      displayName: "bb connect",
      attention: null,
      availability: {
        status: "unavailable",
        message: "The gate rejected this bb's credential",
      },
    },
    CONNECT_UNPAIRED.providers[1]!,
  ],
};

const MANUAL_WITHOUT_URL: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  defaultProviderId: "direct",
};

function makeProvider(
  overrides: Partial<SystemMachineProvider> &
    Pick<SystemMachineProvider, "id" | "displayName">,
): SystemMachineProvider {
  return {
    icon: "Cloud",
    logoUrl: null,
    pluginId: `plugin-${overrides.id}`,
    inputs: null,
    acceptsEmptyInputs: true,
    supportsSuspend: false,
    environmentRow: null,
    availability: { status: "available" },
    ...overrides,
  };
}

const MODAL_PROVIDER = makeProvider({
  id: "modal-sandbox",
  displayName: "Modal sandbox",
  icon: "Box",
  environmentRow: {
    displayName: "New sandbox",
    environmentProviderId: "project-checkout",
  },
  supportsSuspend: true,
});

const SETUP_REQUIRED_PROVIDER = makeProvider({
  id: "acme-fleet",
  displayName: "Acme Fleet",
  icon: "Server",
  availability: {
    status: "setup-required",
    message: "Add an API token in plugin settings",
  },
});

const UNAVAILABLE_PROVIDER = makeProvider({
  id: "zeta-metal",
  displayName: "Zeta Metal",
  icon: "HardDrive",
  availability: {
    status: "unavailable",
    message: "Region eu-west is offline",
  },
});

type ConfigState =
  | { kind: "ready"; access: ServerAccessStatus }
  | { kind: "pending" }
  | { kind: "error" };

function createStoryQueryClient(
  config: ConfigState,
  providers: readonly SystemMachineProvider[],
): QueryClient {
  const queryClient = createAppQueryClient({
    showMutationErrorToasts: false,
    defaultOptions: {
      mutations: { retry: false },
      queries: {
        gcTime: Infinity,
        retry: false,
        retryOnMount: false,
        staleTime: Infinity,
      },
    },
  });
  if (config.kind === "ready") {
    queryClient.setQueryData(
      systemConfigQueryKey(),
      makeSystemConfig({ serverAccess: config.access }),
    );
  } else {
    void queryClient
      .fetchQuery({
        queryKey: systemConfigQueryKey(),
        queryFn:
          config.kind === "pending"
            ? () => new Promise<never>(() => {})
            : () => Promise.reject(new Error("Server is unreachable")),
      })
      .catch(() => {});
  }
  queryClient.setQueryData(systemMachineProvidersQueryKey(), providers);
  return queryClient;
}

function Stage({
  config,
  providers = [],
  children,
}: {
  config: ConfigState;
  providers?: readonly SystemMachineProvider[];
  children?: ReactNode;
}) {
  const [queryClient] = useState(() =>
    createStoryQueryClient(config, providers),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <DialogStage>
        {children ?? <CreateMachineContent open onOpenChange={noop} />}
      </DialogStage>
    </QueryClientProvider>
  );
}

export function AccessGate() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="checking"
        hint="system config still loading — no heading yet, so nothing swaps when it resolves"
      >
        <Stage config={{ kind: "pending" }} />
      </StoryRow>
      <StoryRow
        label="bb connect unpaired"
        hint="default provider is setup-required — primary action leaves for plugin settings"
      >
        <Stage config={{ kind: "ready", access: CONNECT_UNPAIRED }} />
      </StoryRow>
      <StoryRow
        label="bb connect unavailable"
        hint="paired once, now refused — status line appears because there is a verdict to report"
      >
        <Stage config={{ kind: "ready", access: CONNECT_UNAVAILABLE }} />
      </StoryRow>
      <StoryRow
        label="manual, no address"
        hint="direct provider with effectiveUrl null — machines have nothing to dial"
      >
        <Stage config={{ kind: "ready", access: MANUAL_WITHOUT_URL }} />
      </StoryRow>
      <StoryRow
        label="config unreachable"
        hint="the access check itself failed — retry instead of setup"
      >
        <Stage config={{ kind: "error" }} />
      </StoryRow>
    </StoryCard>
  );
}

export function ProviderChoice() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="one provider"
        hint="a single provider is selected for you, so the modal opens on its create card"
      >
        <Stage
          config={{ kind: "ready", access: CONNECT_PAIRED }}
          providers={[MODAL_PROVIDER]}
        />
      </StoryRow>
      <StoryRow
        label="several providers"
        hint="nothing is selected — click a row to reveal its card; unavailable rows are disabled"
      >
        <Stage
          config={{ kind: "ready", access: CONNECT_PAIRED }}
          providers={[
            MODAL_PROVIDER,
            SETUP_REQUIRED_PROVIDER,
            UNAVAILABLE_PROVIDER,
          ]}
        />
      </StoryRow>
      <StoryRow
        label="provider needs setup"
        hint="selected but setup-required — the action configures the plugin instead of creating"
      >
        <Stage
          config={{ kind: "ready", access: CONNECT_PAIRED }}
          providers={[SETUP_REQUIRED_PROVIDER]}
        />
      </StoryRow>
      <StoryRow
        label="lone unavailable provider"
        hint="a single provider is auto-selected without checking availability, so its disabled row still offers Create"
      >
        <Stage
          config={{ kind: "ready", access: CONNECT_PAIRED }}
          providers={[UNAVAILABLE_PROVIDER]}
        />
      </StoryRow>
      <StoryRow
        label="no providers installed"
        hint="access is ready and the list is empty — only Close remains"
      >
        <Stage config={{ kind: "ready", access: CONNECT_PAIRED }} />
      </StoryRow>
    </StoryCard>
  );
}
