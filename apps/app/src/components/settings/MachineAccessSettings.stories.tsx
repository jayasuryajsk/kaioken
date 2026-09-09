import {
  MachineAccessControlsContent,
  MachineAccessSettingsContent,
} from "./MachineAccessSettings";
import {
  CONNECT_NEEDS_ATTENTION,
  CONNECT_PAIRED,
  CONNECT_PAIRED_WITHOUT_URL,
  CONNECT_UNAVAILABLE,
  CONNECT_UNPAIRED,
  MANUAL_WITHOUT_URL,
  MANUAL_WITH_URL,
  METHOD_NOT_INSTALLED,
  machineAccessState,
} from "../../../.ladle/machine-story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { DialogStage } from "../../../.ladle/story-dialog-stage";

export default {
  title: "settings/Machine Access",
};

export function Section() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="not set up"
        hint="setup-required — no status verdict, just the explanation and a primary action"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_UNPAIRED)}
        />
      </StoryRow>
      <StoryRow
        label="connected"
        hint="available with a public URL — the action drops to secondary"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_PAIRED)}
        />
      </StoryRow>
      <StoryRow
        label="connected, no URL yet"
        hint="available before the tunnel reports an address"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_PAIRED_WITHOUT_URL)}
        />
      </StoryRow>
      <StoryRow
        label="unavailable"
        hint="paired once and now refused — the provider's message replaces the explanation"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_UNAVAILABLE)}
        />
      </StoryRow>
      <StoryRow
        label="needs attention"
        hint="a diagnostic that does not change availability, shown above the row"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(CONNECT_NEEDS_ATTENTION)}
        />
      </StoryRow>
      <StoryRow
        label="manual with address"
        hint="the direct provider — the saved URL is the placeholder"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(MANUAL_WITH_URL)}
        />
      </StoryRow>
      <StoryRow
        label="manual, invalid address"
        hint="a rejected draft — destructive text in the hint's place, announced as an alert"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(MANUAL_WITH_URL, {
            draft: "notaurl",
            error: "Enter a valid HTTP or HTTPS URL without credentials",
          })}
        />
      </StoryRow>
      <StoryRow
        label="saving"
        hint="the update is in flight — every control is disabled"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(MANUAL_WITH_URL, {
            draft: "https://bb.example.com/",
            disabled: true,
            saving: true,
          })}
        />
      </StoryRow>
      <StoryRow
        label="method not installed"
        hint="the saved provider id is not registered on this server"
      >
        <MachineAccessSettingsContent
          machineAccess={machineAccessState(METHOD_NOT_INSTALLED)}
        />
      </StoryRow>
    </StoryCard>
  );
}

export function InTheAddMachineDialog() {
  return (
    <StoryCard labelWidth="200px">
      <StoryRow
        label="not set up"
        hint="the same controls without settings chrome — they stack and go full width under @lg"
      >
        <DialogStage>
          <MachineAccessControlsContent
            machineAccess={machineAccessState(CONNECT_UNPAIRED)}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="manual without address"
        hint="the address field is the whole gate for the direct provider"
      >
        <DialogStage>
          <MachineAccessControlsContent
            machineAccess={machineAccessState(MANUAL_WITHOUT_URL)}
          />
        </DialogStage>
      </StoryRow>
      <StoryRow
        label="connected"
        hint="reachable — shown here only because the picker can still be changed"
      >
        <DialogStage>
          <MachineAccessControlsContent
            machineAccess={machineAccessState(CONNECT_PAIRED)}
          />
        </DialogStage>
      </StoryRow>
    </StoryCard>
  );
}
