import { MachineAccessGate, ProviderMachineSetup } from "./CreateMachineDialog";
import { MachineAccessControlsContent } from "@/components/settings/MachineAccessSettings";
import {
  CONNECT_UNAVAILABLE,
  CONNECT_UNPAIRED,
  MANUAL_WITHOUT_URL,
  MODAL_MACHINE_PROVIDER,
  SETUP_REQUIRED_MACHINE_PROVIDER,
  UNAVAILABLE_MACHINE_PROVIDER,
  machineAccessState,
} from "../../../.ladle/machine-story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "dialogs/Add a Machine",
};

const noop = () => {};
const noProviders: never[] = [];

export function AccessGate() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="checking"
        hint="the access check has not answered yet — no heading, so nothing swaps when it does"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "checking" }}>
            {null}
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="bb connect unpaired"
        hint="default provider is setup-required — the primary action leaves for plugin settings"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "blocked" }}>
            <MachineAccessControlsContent
              machineAccess={machineAccessState(CONNECT_UNPAIRED)}
            />
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="bb connect unavailable"
        hint="paired once, now refused — a status line appears because there is a verdict to report"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "blocked" }}>
            <MachineAccessControlsContent
              machineAccess={machineAccessState(CONNECT_UNAVAILABLE)}
            />
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="manual, no address"
        hint="the direct provider with nothing saved — machines would have nothing to dial"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "blocked" }}>
            <MachineAccessControlsContent
              machineAccess={machineAccessState(MANUAL_WITHOUT_URL)}
            />
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="manual, rejected address"
        hint="validation refuses before saving; the message replaces the hint and is announced"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "blocked" }}>
            <MachineAccessControlsContent
              machineAccess={machineAccessState(MANUAL_WITHOUT_URL, {
                draft: "http://localhost:3000",
                error:
                  "Other machines cannot reach localhost. Use a domain or shared-network address.",
              })}
            />
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="check failed"
        hint="the access check itself failed — retry instead of setup"
      >
        <DialogStage>
          <MachineAccessGate state={{ status: "failed", onRetry: noop }}>
            {null}
          </MachineAccessGate>
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}

export function ProviderChoice() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="one provider"
        hint="a single provider is selected for you, so the dialog opens on its create card"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={[MODAL_MACHINE_PROVIDER]}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="several providers"
        hint="nothing is selected — click a row to reveal its card; the unavailable row is disabled"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={[
              MODAL_MACHINE_PROVIDER,
              SETUP_REQUIRED_MACHINE_PROVIDER,
              UNAVAILABLE_MACHINE_PROVIDER,
            ]}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="provider needs setup"
        hint="selected but setup-required — the action configures the plugin instead of creating"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={[SETUP_REQUIRED_MACHINE_PROVIDER]}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="lone unavailable provider"
        hint="a single provider is auto-selected without checking availability, so its disabled row still offers Create"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={[UNAVAILABLE_MACHINE_PROVIDER]}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="no providers installed"
        hint="access is ready and the list is empty — only Close remains"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={noProviders}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
