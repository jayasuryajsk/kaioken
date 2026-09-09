import { MachineAccessGate, ProviderMachineSetup } from "./CreateMachineDialog";
import { MachineAccessControlsContent } from "@/components/settings/MachineAccessSettings";
import {
  CONNECT_UNAVAILABLE,
  CONNECT_UNPAIRED,
  MANUAL_WITHOUT_URL,
  MANUAL_MACHINE_PROVIDER,
  MODAL_MACHINE_PROVIDER,
  MODAL_NEEDS_TOKEN_PROVIDER,
  MODAL_UNRENDERABLE_INPUTS_PROVIDER,
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
        hint="the access check itself failed, so nothing is known about access — retry, and no setup copy"
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
        hint="a stock bb ships only manual setup, so it is chosen for you and the dialog opens on its action"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={[MANUAL_MACHINE_PROVIDER]}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="several providers"
        hint="the two that ship — every one is pickable, and its own message appears once chosen"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={[MANUAL_MACHINE_PROVIDER, MODAL_MACHINE_PROVIDER]}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="cloud provider ready"
        hint="Modal is configured, so creating is the only thing left to do"
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
        label="cloud provider needs a token"
        hint="the only state Modal reports besides available; its own copy, and Configure instead of Create"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={[MODAL_NEEDS_TOKEN_PROVIDER]}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="inputs the app cannot render"
        hint="the provider requires inputs but registers no control, so Create stays disabled with nothing to explain it"
      >
        <DialogStage>
          <ProviderMachineSetup
            onOpenChange={noop}
            providers={[MODAL_UNRENDERABLE_INPUTS_PROVIDER]}
            onSelectSetup={noop}
            setupIds={noProviders}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="unavailable"
        hint="a contract state no shipped provider returns today — its message replaces the create action"
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
        hint="access is ready but nothing is installed, so the picker has nothing to offer"
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
