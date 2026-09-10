import type { KaiokenDesktopInfo } from "@kaioken/desktop-contract";

export function resolveBbDesktopPlatform(
  platform: NodeJS.Platform,
): KaiokenDesktopInfo["platform"] {
  return platform === "darwin" ? "macos" : "linux";
}
