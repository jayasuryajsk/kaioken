import { useState } from "react";
import { QueryClientProvider, type QueryClient } from "@tanstack/react-query";
import type { MachineEnvironmentList } from "@bb/server-contract";
import { defaultAppSettings } from "@bb/domain";
import {
  MachineEnvironmentSettings,
  machineEnvironmentQueryKey,
} from "./MachineEnvironmentSettings";
import { createAppQueryClient } from "@/lib/query-client";
import { systemConfigQueryKey } from "@/hooks/queries/query-keys";
import { makeSystemConfig } from "@/test/fixtures/system-config";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "settings/Machine Environment",
};

function secret(
  name: string,
  note: string | null = null,
): MachineEnvironmentList["variables"][number] {
  return { name, value: null, secret: true, note };
}

const LOGGED_IN: MachineEnvironmentList = {
  builtInGit: { status: "logged in", statusMessage: "gh is authenticated" },
  variables: [],
};

const NOT_LOGGED_IN: MachineEnvironmentList = {
  builtInGit: { status: "not logged in", statusMessage: "gh is signed out" },
  variables: [],
};

const GIT_DISABLED: MachineEnvironmentList = {
  builtInGit: { status: "disabled", statusMessage: "Automatic token is off" },
  variables: [],
};

const OVERRIDDEN: MachineEnvironmentList = {
  builtInGit: {
    status: "overridden",
    statusMessage: "A GH_TOKEN variable takes precedence",
  },
  variables: [secret("GH_TOKEN")],
};

const SEVERAL: MachineEnvironmentList = {
  builtInGit: { status: "logged in", statusMessage: "gh is authenticated" },
  variables: [
    secret("ANTHROPIC_API_KEY"),
    secret("DATABASE_URL", "Points at the staging replica, not production."),
    secret("SENTRY_DSN"),
  ],
};

type EnvironmentState =
  | { kind: "ready"; environment: MachineEnvironmentList }
  | { kind: "error" };

function createStoryQueryClient(
  state: EnvironmentState,
  gitCredentialsEnabled: boolean,
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
  queryClient.setQueryData(
    systemConfigQueryKey(),
    makeSystemConfig({
      generalSettings: {
        ...defaultAppSettings,
        machineGitCredentialsEnabled: gitCredentialsEnabled,
      },
    }),
  );
  if (state.kind === "ready") {
    queryClient.setQueryData(machineEnvironmentQueryKey, state.environment);
  } else {
    void queryClient
      .fetchQuery({
        queryKey: machineEnvironmentQueryKey,
        queryFn: () => Promise.reject(new Error("Server is unreachable")),
      })
      .catch(() => {});
  }
  return queryClient;
}

function Stage({
  state,
  gitCredentialsEnabled = true,
}: {
  state: EnvironmentState;
  gitCredentialsEnabled?: boolean;
}) {
  const [queryClient] = useState(() =>
    createStoryQueryClient(state, gitCredentialsEnabled),
  );
  return (
    <QueryClientProvider client={queryClient}>
      <div className="w-full max-w-3xl">
        <MachineEnvironmentSettings />
      </div>
    </QueryClientProvider>
  );
}

export function Section() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="automatic token only"
        hint="no user variables — the GH_TOKEN row is read-only and its note stays on one line"
      >
        <Stage state={{ kind: "ready", environment: LOGGED_IN }} />
      </StoryRow>
      <StoryRow
        label="github signed out"
        hint="an alert in the same slot as the note; it truncates like every other status"
      >
        <Stage state={{ kind: "ready", environment: NOT_LOGGED_IN }} />
      </StoryRow>
      <StoryRow
        label="automatic token off"
        hint="the switch is off, so the row and its note dim together"
      >
        <Stage
          state={{ kind: "ready", environment: GIT_DISABLED }}
          gitCredentialsEnabled={false}
        />
      </StoryRow>
      <StoryRow
        label="overridden by a variable"
        hint="a user GH_TOKEN replaces the automatic row entirely and explains itself"
      >
        <Stage state={{ kind: "ready", environment: OVERRIDDEN }} />
      </StoryRow>
      <StoryRow
        label="several variables"
        hint="saved secrets never return a value; one carries a note"
      >
        <Stage state={{ kind: "ready", environment: SEVERAL }} />
      </StoryRow>
      <StoryRow
        label="could not load"
        hint="the variables request failed — the automatic row still renders from config"
      >
        <Stage state={{ kind: "error" }} />
      </StoryRow>
    </StoryCard>
  );
}
