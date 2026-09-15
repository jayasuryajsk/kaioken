import { useEffect } from "react";
import { Link } from "react-router-dom";
import { Button } from "@kaioken/shared-ui/button";
import { SettingsSection } from "@/components/ui/settings-section";
import { PluginSettingsSections } from "@/components/plugin/PluginSettingsSections";
import { AccountServersSettingsSection } from "./AccountServersSettingsSection";
import { MachinesSettingsSection } from "./MachinesSettingsSection";
import { SshConnectionsSettingsSection } from "./SshConnectionsSettingsSection";
import { bootPluginFrontends } from "@/lib/plugin-frontend-lazy";
import { getPluginDetailRoutePath } from "@/lib/route-paths";
import { usePluginSlots } from "@/lib/plugin-slots";

export function ConnectionsSettingsSection() {
  const slots = usePluginSlots();
  useEffect(() => {
    void bootPluginFrontends();
  }, []);
  const hasConnect = slots.settingsSections.some(
    (section) => section.pluginId === "connect",
  );
  return (
    <>
      <SettingsSection
        title="Allow access to this computer"
        description="Use this computer's projects, tasks and tools from another device. Work continues here when you disconnect."
      >
        <div className="space-y-6">
          {hasConnect ? (
            <PluginSettingsSections pluginId="connect" />
          ) : (
            <Button variant="outline" asChild>
              <Link to={getPluginDetailRoutePath({ pluginId: "connect" })}>
                Set up remote access
              </Link>
            </Button>
          )}
          <PluginSettingsSections pluginId="keep-awake" />
        </div>
      </SettingsSection>
      <AccountServersSettingsSection />
      <SshConnectionsSettingsSection />
      <details className="group space-y-4">
        <summary className="cursor-pointer text-sm font-medium text-foreground">
          Advanced: execution workers
        </summary>
        <p className="text-sm text-muted-foreground">
          Enroll a host daemon for this server to manage. To use another
          computer's existing Kaioken projects and tasks, connect to it above.
        </p>
        <MachinesSettingsSection />
      </details>
    </>
  );
}
