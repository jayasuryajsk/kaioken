import type { Host, MachineLifecycle } from "@bb/domain";
import { makeHost } from "@bb/test-helpers/domain-fixtures";
import { MachineRowContent } from "./MachinesSettingsSection";
import { SettingsRowList } from "@/components/ui/settings-section";
import {
  MANUAL_MACHINE_PROVIDER,
  MODAL_MACHINE_PROVIDER,
} from "../../../.ladle/machine-story-fixtures";
import { StoryCard, StoryRow } from "../../../.ladle/story-card";

export default {
  title: "settings/Machines",
};

const noop = () => {};
const now = Date.parse("2026-09-09T12:00:00Z");

function lifecycle(overrides: Partial<MachineLifecycle> = {}): MachineLifecycle {
  return {
    phase: "active",
    suspendedAt: null,
    retireAt: null,
    progress: null,
    teardown: null,
    ...overrides,
  };
}

function sandbox(overrides: Partial<Host> = {}): Host {
  return makeHost({
    id: "host_sandbox",
    name: "Modal sandbox 3f9a",
    machineProviderId: MODAL_MACHINE_PROVIDER.id,
    ...overrides,
  });
}

function Row({
  host,
  machineProvider = MODAL_MACHINE_PROVIDER,
  lifecycleMessage = null,
  ...overrides
}: {
  host: Host;
  machineProvider?: typeof MODAL_MACHINE_PROVIDER | null;
  lifecycleMessage?: string | null;
} & Partial<Parameters<typeof MachineRowContent>[0]>) {
  return (
    <div className="min-w-0 flex-1">
      <SettingsRowList>
        <MachineRowContent
          host={host}
          isPrimary={false}
          isThisMachine={false}
          showPrimaryBadge={false}
          platformLabel={null}
          projectCount={0}
          now={now}
          onRename={noop}
          onRemove={noop}
          onRetryUpdate={noop}
          onSuspend={noop}
          onResume={noop}
          onRetryCleanup={noop}
          lifecycleActionPending={false}
          retryUpdatePending={false}
          machineProvider={machineProvider}
          lifecycleMessage={lifecycleMessage}
          {...overrides}
        />
      </SettingsRowList>
    </div>
  );
}

export function Rows() {
  return (
    <StoryCard labelWidth="220px" className="max-w-4xl">
      <StoryRow
        label="this machine"
        hint="the machine bb itself runs on: no provider, so no provider chip"
      >
        <Row
          host={makeHost({
            id: "host_local",
            name: "Michael's MacBook Pro",
            machineProviderId: null,
          })}
          machineProvider={null}
          isPrimary
          isThisMachine
          showPrimaryBadge
          platformLabel="macOS"
          projectCount={1}
        />
      </StoryRow>
      <StoryRow
        label="manually paired"
        hint="enrolled by running a command; the plugin owns nothing at runtime, so there is no suspend action"
      >
        <Row
          host={makeHost({
            id: "host_build",
            name: "michael-build-box",
            machineProviderId: MANUAL_MACHINE_PROVIDER.id,
            maxPermissionMode: "auto",
          })}
          machineProvider={MANUAL_MACHINE_PROVIDER}
          projectCount={2}
        />
      </StoryRow>
      <StoryRow
        label="provider-made, running"
        hint="a live sandbox — the provider chip carries the plugin's own logo"
      >
        <Row host={sandbox({ name: "Modal sandbox 0af2" })} projectCount={1} />
      </StoryRow>
      <StoryRow
        label="pausing"
        hint="the provider reports its own progress, which replaces the connection line"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 91c4",
            lifecycle: lifecycle({
              phase: "suspending",
              progress: "Saving the sandbox filesystem",
            }),
          })}
        />
      </StoryRow>
      <StoryRow
        label="paused"
        hint="suspended and disconnected; resuming is offered in the row menu"
      >
        <Row
          host={sandbox({
            status: "disconnected",
            lastSeenAt: now - 3 * 7 * 24 * 60 * 60_000,
            lifecycle: lifecycle({
              phase: "suspended",
              suspendedAt: now - 3 * 7 * 24 * 60 * 60_000,
            }),
          })}
        />
      </StoryRow>
      <StoryRow
        label="retiring"
        hint="removal is under way and the machine is still reachable"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 7c11",
            lifecycle: lifecycle({ phase: "retiring", retireAt: now }),
          })}
        />
      </StoryRow>
      <StoryRow
        label="cleanup failed"
        hint="teardown gave up, so the row explains what is left behind and offers removal without opening the menu"
      >
        <Row
          host={sandbox({
            name: "Modal sandbox 55de",
            status: "disconnected",
            lastSeenAt: now - 3 * 7 * 24 * 60 * 60_000,
            lifecycle: lifecycle({
              phase: "retiring",
              retireAt: now,
              teardown: { status: "failed", attempt: 3 },
            }),
          })}
          lifecycleMessage="Modal refused to delete the sandbox after 3 attempts. Removing the machine here clears it from bb; delete the sandbox in Modal too."
        />
      </StoryRow>
    </StoryCard>
  );
}
