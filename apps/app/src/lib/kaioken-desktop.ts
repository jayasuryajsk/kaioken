import type {
  KaiokenDesktopApi,
  KaiokenDesktopBrowserApi,
  KaiokenDesktopWindowState,
} from "@kaioken/desktop-contract";
import { getWorkspaceBrowserApi } from "./federation/workspace-browser-store";

export const MACOS_TRAFFIC_LIGHT_RESERVE_OFFSET_CLASS = "left-[84px]";
export const MACOS_COLLAPSED_TOP_LEFT_RESERVE_CLASS = "pl-[104px]";

export const BROWSER_SIDEBAR_TRIGGER_INSET_CLASS = "pl-[12px]";
export const BROWSER_COLLAPSED_HEADER_RESERVE_CLASS =
  "pl-[32px] max-md:pointer-coarse:pl-[40px]";
export const MACOS_WINDOW_DRAG_CLASS =
  "select-none [app-region:drag] [-webkit-app-region:drag]";
export const MACOS_APP_REGION_NO_DRAG_CLASS =
  "[app-region:no-drag] [-webkit-app-region:no-drag]";
export const MACOS_WINDOW_NO_DRAG_CLASS = `relative z-50 ${MACOS_APP_REGION_NO_DRAG_CLASS}`;

export const CHROME_ROW_HEIGHT_CLASS = "h-(--kaioken-app-chrome-row-height)";
export const CHROME_ROW_CLASS = `flex ${CHROME_ROW_HEIGHT_CLASS} items-center`;

export const MACOS_CHROME_CONTROL_AXIS_CLASS =
  "[--kaioken-macos-chrome-control-y:2px] [transform:translateY(var(--kaioken-macos-chrome-control-y))]";
export const MACOS_CHROME_CONTROL_NO_DRAG_CLASS = `${MACOS_WINDOW_NO_DRAG_CLASS} ${MACOS_CHROME_CONTROL_AXIS_CLASS}`;
export const MACOS_CHROME_TRAFFIC_LIGHT_AXIS_NUDGE_CLASS =
  MACOS_CHROME_CONTROL_AXIS_CLASS;

type KaiokenDesktopInfoResult = KaiokenDesktopApi | null;
export const DEFAULT_DESKTOP_WINDOW_STATE: KaiokenDesktopWindowState = {
  isFullScreen: false,
};

export function getBbDesktopInfo(): KaiokenDesktopInfoResult {
  if (typeof window === "undefined") {
    return null;
  }
  return window.kaiokenDesktop ?? null;
}

export function shouldUseMacosDesktopChrome(
  desktopInfo: KaiokenDesktopInfoResult,
): boolean {
  return desktopInfo?.platform === "macos";
}

export function shouldReserveMacosTrafficLights({
  desktopInfo,
  windowState,
}: {
  desktopInfo: KaiokenDesktopInfoResult;
  windowState: KaiokenDesktopWindowState;
}): boolean {
  return shouldUseMacosDesktopChrome(desktopInfo) && !windowState.isFullScreen;
}

export function getDesktopBrowserApi(): KaiokenDesktopBrowserApi | null {
  return getBbDesktopInfo()?.browser ?? getWorkspaceBrowserApi();
}

export function isDesktopBrowserAvailable(): boolean {
  return getDesktopBrowserApi() !== null;
}
