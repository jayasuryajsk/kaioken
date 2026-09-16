import { definePluginApp } from "@get-kaioken/plugin-sdk/app";
import { RoutingPanel } from "./components/RoutingPanel";

export default definePluginApp((app) => {
  app.slots.settingsSection({
    id: "routing",
    title: "Models in the picker",
    description:
      "Choose which endpoint models appear in the composer's model menu. Pick the harness there as usual, then the model; the thread is routed through that endpoint with your key.",
    component: RoutingPanel,
  });
});
