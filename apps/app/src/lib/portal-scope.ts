import { useContext } from "react";
import { PluginContext } from "@/components/plugin/plugin-context";

export function usePortalScopeProps(): {
  "data-kaioken-portaled-overlay": "";
  "data-kaioken-plugin-root"?: "";
  "data-kaioken-plugin"?: string;
} {
  const pluginId = useContext(PluginContext);
  return pluginId === null
    ? { "data-kaioken-portaled-overlay": "" }
    : {
        "data-kaioken-portaled-overlay": "",
        "data-kaioken-plugin-root": "",
        "data-kaioken-plugin": pluginId,
      };
}
