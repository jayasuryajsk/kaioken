declare const __BB_PLUGIN_ID__: string | undefined;

export function usePortalScopeProps(): {
  "data-kaioken-portaled-overlay": "";
  "data-kaioken-plugin-root"?: "";
  "data-kaioken-plugin"?: string;
} {
  const pluginId =
    typeof __BB_PLUGIN_ID__ === "string" ? __BB_PLUGIN_ID__ : undefined;
  return {
    "data-kaioken-portaled-overlay": "",
    "data-kaioken-plugin-root": "",
    ...(pluginId !== undefined ? { "data-kaioken-plugin": pluginId } : {}),
  };
}
