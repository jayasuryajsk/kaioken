import type { ExperimentalMachineSetupProps } from "@get-bb/plugin-sdk/app";
import { installTestPluginRuntime } from "@get-bb/plugin-sdk/testing/app";
import { StoryCard, StoryRow } from "../../apps/app/.ladle/story-card";
import { DialogStage } from "../../apps/app/.ladle/story-dialog-stage";

installTestPluginRuntime();
const { ManualMachineSetupView: ManualMachineSetup } = await import("./app");

export default {
  title: "plugins/Manual machine setup",
};

const noop = () => {};
const never = () => new Promise<never>(() => {});

const COMMAND =
  "curl -fsSL -H 'X-BB-Enrollment: bbde_MUtbGDavhoebJjRGJbPLSvPFkyaUfbbACEuDygrUhFhRcCjSpKjUaqFaGkGYTKCO' 'https://sawyer.getbb.app/install.sh' | sh";

function client(
  enrollmentCommand: (
    launchId: string,
  ) => Promise<{ command: string | null; expiresAt: number | null }>,
): ExperimentalMachineSetupProps["client"] & {
  readCommand: typeof enrollmentCommand;
} {
  return {
    readCommand: enrollmentCommand,
    hosts: {
      experimental_submit: async () =>
        ({ id: "launch_story", phase: "creating" }) as never,
      experimental_follow: never,
      experimental_cancel: async () => ({}) as never,
    },
  };
}

const preparing = client(never);

const ready = client(async () => ({
  command: COMMAND,
  expiresAt: Date.now() + 14 * 60_000 + 59_000,
}));

const expired = client(async () => ({
  command: COMMAND,
  expiresAt: Date.now() - 1_000,
}));

const unavailable: ExperimentalMachineSetupProps["client"] = {
  hosts: {
    ...ready.hosts,
    experimental_submit: async () => {
      throw new Error("The server is not reachable.");
    },
  },
};

export function Enrollment() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="preparing"
        hint="the view submits a launch on mount; until the server has a bootstrap there is no command to show"
      >
        <DialogStage>
          <ManualMachineSetup
            client={preparing}
            readCommand={preparing.readCommand}
            onClose={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="command ready"
        hint="what a stock bb shows for its only provider: run this on the machine, with a countdown to expiry"
      >
        <DialogStage>
          <ManualMachineSetup
            client={ready}
            readCommand={ready.readCommand}
            onClose={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="expired"
        hint="the enrollment credential timed out before the machine connected"
      >
        <DialogStage>
          <ManualMachineSetup
            client={expired}
            readCommand={expired.readCommand}
            onClose={noop}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="could not prepare"
        hint="submitting the launch failed, so the view offers to try again"
      >
        <DialogStage>
          <ManualMachineSetup
            client={unavailable}
            readCommand={ready.readCommand}
            onClose={noop}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
