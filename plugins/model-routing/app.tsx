import { definePluginApp } from "@get-kaioken/plugin-sdk/app";
import { RoutingPanel } from "./components/RoutingPanel";

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "routing",
    title: "Model catalogue",
    description:
      "Load the models your endpoint publishes and pick the one Claude Code should ask for. Keys and the endpoint itself are set in the settings above.",
    component: RoutingPanel,
  });
});
