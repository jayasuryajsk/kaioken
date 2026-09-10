import type { KaiokenPluginApi } from "@get-kaioken/plugin-sdk";

type AutomationSignalKind = "automations-changed" | "automation-runs-changed";

export function publishAutomationChange(
  bb: Pick<KaiokenPluginApi, "realtime">,
  projectId: string,
  kinds: AutomationSignalKind | AutomationSignalKind[],
): void {
  for (const kind of Array.isArray(kinds) ? kinds : [kinds]) {
    bb.realtime.publish("automations", { projectId, kind });
  }
}
