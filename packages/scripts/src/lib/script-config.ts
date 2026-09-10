import type { KaiokenRuntimeMode } from "@kaioken/config/runtime";

export function resolveNodeEnvironment(
  mode: KaiokenRuntimeMode,
): "development" | "production" {
  return mode === "dev" ? "development" : "production";
}
