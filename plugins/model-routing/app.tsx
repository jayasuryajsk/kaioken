import { definePluginApp } from "@get-kaioken/plugin-sdk/app";
import { RoutingPanel } from "./components/RoutingPanel";

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "routing",
    title: "Model catalogue",
    description:
      "Load the models your endpoint publishes, choose which harness you are picking for, then pick the model. Keys and endpoints are set in the settings above.",
    component: RoutingPanel,
  });
});
