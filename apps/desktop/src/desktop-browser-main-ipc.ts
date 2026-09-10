import { BrowserWindow, ipcMain, type IpcMainEvent } from "electron";
import {
  kaiokenDesktopBrowserAttachRequestSchema,
  kaiokenDesktopBrowserFindInPageRequestSchema,
  kaiokenDesktopBrowserNavigateRequestSchema,
  kaiokenDesktopBrowserSetBoundsRequestSchema,
  kaiokenDesktopBrowserSetVisibleRequestSchema,
  kaiokenDesktopBrowserStopFindInPageRequestSchema,
  kaiokenDesktopBrowserTabRefSchema,
} from "@kaioken/desktop-contract";
import {
  KAIOKEN_DESKTOP_BROWSER_ATTACH_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_DETACH_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_FOCUS_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_RELOAD_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_STOP_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
} from "./desktop-browser-ipc.js";
import type { DesktopBrowserViewManager } from "./desktop-browser-view.js";

interface DesktopBrowserTabCommandArgs {
  hostWindow: BrowserWindow;
  tabId: string;
}

type DesktopBrowserTabCommand = (args: DesktopBrowserTabCommandArgs) => void;

interface RegisterDesktopBrowserTabCommandArgs {
  channel: string;
  run: DesktopBrowserTabCommand;
}

function hostWindowFromBrowserIpcEvent(
  event: IpcMainEvent,
): BrowserWindow | null {
  return BrowserWindow.fromWebContents(event.sender);
}

function registerTabCommand(args: RegisterDesktopBrowserTabCommandArgs): void {
  ipcMain.on(args.channel, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = kaiokenDesktopBrowserTabRefSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    args.run({ hostWindow, tabId: parsed.data.tabId });
  });
}

export function registerDesktopBrowserIpc(
  manager: DesktopBrowserViewManager,
): void {
  ipcMain.on(KAIOKEN_DESKTOP_BROWSER_ATTACH_CHANNEL, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = kaiokenDesktopBrowserAttachRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    manager.attach({ hostWindow, request: parsed.data });
  });

  ipcMain.on(KAIOKEN_DESKTOP_BROWSER_NAVIGATE_CHANNEL, (event, payload: unknown) => {
    const hostWindow = hostWindowFromBrowserIpcEvent(event);
    if (hostWindow === null) {
      return;
    }
    const parsed = kaiokenDesktopBrowserNavigateRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    manager.navigate({ hostWindow, request: parsed.data });
  });

  ipcMain.on(
    KAIOKEN_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = kaiokenDesktopBrowserSetBoundsRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setBounds({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    KAIOKEN_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = kaiokenDesktopBrowserSetVisibleRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setVisible({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    KAIOKEN_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = kaiokenDesktopBrowserSetVisibleRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.setVisibleWithoutFocus({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    KAIOKEN_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed = kaiokenDesktopBrowserFindInPageRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.findInPage({ hostWindow, request: parsed.data });
    },
  );

  ipcMain.on(
    KAIOKEN_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
    (event, payload: unknown) => {
      const hostWindow = hostWindowFromBrowserIpcEvent(event);
      if (hostWindow === null) {
        return;
      }
      const parsed =
        kaiokenDesktopBrowserStopFindInPageRequestSchema.safeParse(payload);
      if (!parsed.success) {
        return;
      }
      manager.stopFindInPage({ hostWindow, request: parsed.data });
    },
  );

  registerTabCommand({
    channel: KAIOKEN_DESKTOP_BROWSER_DETACH_CHANNEL,
    run: (args) => manager.detach(args),
  });
  registerTabCommand({
    channel: KAIOKEN_DESKTOP_BROWSER_FOCUS_CHANNEL,
    run: (args) => manager.focus(args),
  });
  registerTabCommand({
    channel: KAIOKEN_DESKTOP_BROWSER_GO_BACK_CHANNEL,
    run: (args) => manager.goBack(args),
  });
  registerTabCommand({
    channel: KAIOKEN_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
    run: (args) => manager.goForward(args),
  });
  registerTabCommand({
    channel: KAIOKEN_DESKTOP_BROWSER_RELOAD_CHANNEL,
    run: (args) => manager.reload(args),
  });
  registerTabCommand({
    channel: KAIOKEN_DESKTOP_BROWSER_STOP_CHANNEL,
    run: (args) => manager.stop(args),
  });
}
