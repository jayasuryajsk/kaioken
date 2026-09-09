import type { ReactNode } from "react";
import { Button } from "@bb/shared-ui/button";
import { StoryCard, StoryRow } from "../../../../.ladle/story-card";
import { ProviderCliVersionBanner } from "./ProviderCliVersionBanner";
import { ProviderRequirementBanner } from "./ProviderRequirementBanner";

export default {
  title: "promptbox/banner/Provider Requirement",
};

const noop = () => {};

function Stage({
  children,
  size,
}: {
  children: ReactNode;
  size: "desktop" | "mobile";
}) {
  return (
    <div
      data-promptbox-shell=""
      className={size === "desktop" ? "min-w-0 flex-1" : "w-[20rem] shrink-0"}
    >
      {children}
    </div>
  );
}

function ResponsiveStage({ children }: { children: ReactNode }) {
  return (
    <div className="flex w-full min-w-0 items-start gap-3 overflow-x-auto">
      <Stage size="desktop">{children}</Stage>
      <Stage size="mobile">{children}</Stage>
    </div>
  );
}

function configureAction(displayName: string) {
  return (
    <Button type="button" size="sm" className="h-8 shrink-0 px-3" onClick={noop}>
      Configure {displayName}
    </Button>
  );
}

export function Requirements() {
  return (
    <StoryCard labelWidth="230px">
      <StoryRow
        label="environment needs configuring"
        hint="the selected environment's provider reports setup-required, so the composer says so before the send is pressed"
      >
        <ResponsiveStage>
          <ProviderRequirementBanner
            title="Modal Sandbox needs configuration"
            description="Configure Modal Sandbox before starting a thread."
            action={configureAction("Modal Sandbox")}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="provider CLI too old"
        hint="both versions are known, and bb can run the update itself"
      >
        <ResponsiveStage>
          <ProviderCliVersionBanner
            displayName="Codex"
            currentVersion="0.135.0"
            minimumSupportedVersion="0.136.0"
            canUpdate
            updating={false}
            onUpdate={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="update running"
        hint="the action reports its own progress and refuses a second click"
      >
        <ResponsiveStage>
          <ProviderCliVersionBanner
            displayName="Codex"
            currentVersion="0.135.0"
            minimumSupportedVersion="0.136.0"
            canUpdate
            updating
            onUpdate={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="bb cannot update it"
        hint="the machine installs this CLI itself, so the banner explains without offering an action"
      >
        <ResponsiveStage>
          <ProviderCliVersionBanner
            displayName="Claude Code"
            currentVersion="2.0.9"
            minimumSupportedVersion="2.1.0"
            canUpdate={false}
            updating={false}
            onUpdate={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="installed version unknown"
        hint="the machine did not report a version, so only the requirement is stated"
      >
        <ResponsiveStage>
          <ProviderCliVersionBanner
            displayName="Cursor"
            currentVersion={null}
            minimumSupportedVersion="0.49.0"
            canUpdate
            updating={false}
            onUpdate={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="required version unknown"
        hint="bb knows the installed version is too old but not what it needs"
      >
        <ResponsiveStage>
          <ProviderCliVersionBanner
            displayName="Cursor"
            currentVersion="0.48.2"
            minimumSupportedVersion={null}
            canUpdate
            updating={false}
            onUpdate={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="neither version known"
        hint="the last-resort copy, with nothing concrete to name"
      >
        <ResponsiveStage>
          <ProviderCliVersionBanner
            displayName="Cursor"
            currentVersion={null}
            minimumSupportedVersion={null}
            canUpdate
            updating={false}
            onUpdate={noop}
          />
        </ResponsiveStage>
      </StoryRow>
      <StoryRow
        label="a long provider name"
        hint="the title and action both carry the name, so the row has to survive a long one"
      >
        <ResponsiveStage>
          <ProviderRequirementBanner
            title="DigitalOcean development droplet needs configuration"
            description="Configure DigitalOcean development droplet before starting a thread."
            action={configureAction("DigitalOcean development droplet")}
          />
        </ResponsiveStage>
      </StoryRow>
    </StoryCard>
  );
}
