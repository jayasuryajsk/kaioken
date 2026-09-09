import { useState } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { ServerAccessStatus } from "@bb/server-contract";
import { defaultAppSettings } from "@bb/domain";
import {
  MachineAccessControls,
  MachineAccessSettings,
} from "./MachineAccessSettings";
import { createAppQueryClient } from "@/lib/query-client";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "settings/Machine Access",
};

const CONNECT_SETUP_REQUIRED = {
  id: "connect",
  displayName: "bb connect",
  attention: null,
  availability: {
    status: "setup-required" as const,
    message: "Pair this bb instance with bb connect",
  },
};

const DIRECT_AVAILABLE = {
  id: "direct",
  displayName: "Manual",
  attention: null,
  availability: { status: "available" as const },
};

function access(overrides: Partial<ServerAccessStatus>): ServerAccessStatus {
  return {
    providers: [CONNECT_SETUP_REQUIRED, DIRECT_AVAILABLE],
    defaultProviderId: "connect",
    effectiveUrl: null,
    urlSource: null,
    ...overrides,
  };
}

const NOT_SET_UP = access({});

const CONNECTED = access({
  providers: [
    {
      ...CONNECT_SETUP_REQUIRED,
      availability: {
        status: "available",
        serverUrl: "https://sawyer.getbb.app",
      },
    },
    DIRECT_AVAILABLE,
  ],
});

const CONNECTED_WITHOUT_URL = access({
  providers: [
    { ...CONNECT_SETUP_REQUIRED, availability: { status: "available" } },
    DIRECT_AVAILABLE,
  ],
});

const UNAVAILABLE = access({
  providers: [
    {
      ...CONNECT_SETUP_REQUIRED,
      availability: {
        status: "unavailable",
        message: "The gate rejected this bb's credential (HTTP 401)",
      },
    },
    DIRECT_AVAILABLE,
  ],
});

const NEEDS_ATTENTION = access({
  providers: [
    {
      ...CONNECT_SETUP_REQUIRED,
      attention: "2 legacy access records need attention",
      availability: {
        status: "available",
        serverUrl: "https://sawyer.getbb.app",
      },
    },
    DIRECT_AVAILABLE,
  ],
});

const MANUAL_WITH_URL = access({
  defaultProviderId: "direct",
  effectiveUrl: "https://bb.example.com",
  urlSource: "setting",
});

const MANUAL_WITHOUT_URL = access({ defaultProviderId: "direct" });

const PROVIDER_MISSING = access({
  providers: [DIRECT_AVAILABLE],
  defaultProviderId: "tailscale",
});

function createStoryQueryClient(
  serverAccess: ServerAccessStatus,
  machineServerUrl: string | null,
): QueryClient {
  const queryClient = createAppQueryClient({
    showMutationErrorToasts: false,
    defaultOptions: {
      mutations: { retry: false },
      queries: { gcTime: Infinity, retry: false, staleTime: Infinity },
    },
  });
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      serverAccess,
      generalSettings: { ...defaultAppSettings, machineServerUrl },
    }),
  );
  return queryClient;
}

function Stage({
  serverAccess,
  machineServerUrl = null,
  presentation = "settings",
}: {
  serverAccess: ServerAccessStatus;
  machineServerUrl?: string | null;
  presentation?: "settings" | "dialog";
}) {
  const [queryClient] = useState(() =>
    createStoryQueryClient(serverAccess, machineServerUrl),
  );
  return (
    <QueryClientProvider client={queryClient}>
      {presentation === "dialog" ? (
        <DialogStage>
          <MachineAccessControls />
        </DialogStage>
      ) : (
        <div className="w-full max-w-3xl">
          <MachineAccessSettings />
        </div>
      )}
    </QueryClientProvider>
  );
}

export function Section() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="not set up"
        hint="setup-required — no status verdict, just the explanation and a primary action"
      >
        <Stage serverAccess={NOT_SET_UP} />
      </StoryRow>
      <StoryRow
        label="connected"
        hint="available with a public URL — the action drops to secondary"
      >
        <Stage serverAccess={CONNECTED} />
      </StoryRow>
      <StoryRow
        label="connected, no URL yet"
        hint="available before the tunnel reports an address"
      >
        <Stage serverAccess={CONNECTED_WITHOUT_URL} />
      </StoryRow>
      <StoryRow
        label="unavailable"
        hint="paired once and now refused — the provider's message replaces the explanation"
      >
        <Stage serverAccess={UNAVAILABLE} />
      </StoryRow>
      <StoryRow
        label="needs attention"
        hint="a diagnostic that does not change availability, shown above the row"
      >
        <Stage serverAccess={NEEDS_ATTENTION} />
      </StoryRow>
      <StoryRow
        label="manual with address"
        hint="direct provider — the saved URL is the placeholder"
      >
        <Stage
          serverAccess={MANUAL_WITH_URL}
          machineServerUrl="https://bb.example.com"
        />
      </StoryRow>
      <StoryRow
        label="manual without address"
        hint="direct provider, nothing saved — Save stays disabled until the field changes"
      >
        <Stage serverAccess={MANUAL_WITHOUT_URL} />
      </StoryRow>
      <StoryRow
        label="method not installed"
        hint="the saved provider id is not registered on this server"
      >
        <Stage serverAccess={PROVIDER_MISSING} />
      </StoryRow>
    </StoryCard>
  );
}

export function InTheAddMachineDialog() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="not set up"
        hint="same controls without settings chrome — stacks and goes full width under @lg"
      >
        <Stage serverAccess={NOT_SET_UP} presentation="dialog" />
      </StoryRow>
      <StoryRow
        label="manual without address"
        hint="the address field is the whole gate for the direct provider"
      >
        <Stage serverAccess={MANUAL_WITHOUT_URL} presentation="dialog" />
      </StoryRow>
      <StoryRow
        label="connected"
        hint="reachable state, shown here only because the picker can still be changed"
      >
        <Stage serverAccess={CONNECTED} presentation="dialog" />
      </StoryRow>
    </StoryCard>
  );
}
