import { StoryCard, StoryRow } from "../../../.ladle/story-card";
import { MachineServerAccessNoticeContent } from "./MachineServerAccessNotice";
import { machineServerAccessBlockedReason } from "./machine-server-access";
import {
  CONNECT_PAIRED,
  CONNECT_UNAVAILABLE,
  CONNECT_UNPAIRED,
  MANUAL_WITH_URL,
  MANUAL_WITHOUT_URL,
  METHOD_NOT_INSTALLED,
} from "../../../.ladle/machine-story-fixtures";

export default {
  title: "settings/Machine server access notice",
};

export function Reasons() {
  return (
    <StoryCard labelWidth="230px" className="max-w-4xl">
      <StoryRow
        label="bb connect unpaired"
        hint="never set up: the notice asks for configuration rather than repeating the method's own jargon"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(CONNECT_UNPAIRED)}
        />
      </StoryRow>
      <StoryRow
        label="bb connect refused"
        hint="set up but failing, so the method's own words explain what went wrong"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(CONNECT_UNAVAILABLE)}
        />
      </StoryRow>
      <StoryRow
        label="manual, no address saved"
        hint="the direct method is selected with no address saved"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(MANUAL_WITHOUT_URL)}
        />
      </StoryRow>
      <StoryRow
        label="method is not installed"
        hint="the saved default names a plugin that is no longer here"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(METHOD_NOT_INSTALLED)}
        />
      </StoryRow>
      <StoryRow
        label="paired"
        hint="access is ready, so the notice renders nothing at all"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(CONNECT_PAIRED)}
        />
      </StoryRow>
      <StoryRow
        label="manual with an address"
        hint="also ready: a reachable URL is saved"
      >
        <MachineServerAccessNoticeContent
          reason={machineServerAccessBlockedReason(MANUAL_WITH_URL)}
        />
      </StoryRow>
    </StoryCard>
  );
}
