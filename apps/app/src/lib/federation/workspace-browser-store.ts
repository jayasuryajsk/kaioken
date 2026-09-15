import type { KaiokenDesktopBrowserApi } from "@kaioken/desktop-contract";

let browser: KaiokenDesktopBrowserApi | null = null;
export function getWorkspaceBrowserApi(): KaiokenDesktopBrowserApi | null {
  return browser;
}
export function setWorkspaceBrowserApi(
  value: KaiokenDesktopBrowserApi | null,
): void {
  browser = value;
}
