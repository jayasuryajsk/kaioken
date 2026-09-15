import { contextBridge, ipcRenderer, webFrame } from "electron";
import { appCommandIdSchema } from "@kaioken/domain";
import {
  desktopBrowserImportOutcomeSchema,
  desktopBrowserImportSourceSchema,
} from "@kaioken/host-daemon-contract";
import { z } from "zod";
import {
  kaiokenDesktopBrowserFindResultSchema,
  kaiokenDesktopBrowserOpenTabRequestSchema,
  kaiokenDesktopBrowserScopedOpenTabRequestSchema,
  kaiokenDesktopBrowserTabRefSchema,
  kaiokenDesktopBrowserSnapshotSchema,
  kaiokenDesktopBrowserStateSchema,
  kaiokenDesktopBrowserTargetSchema,
  kaiokenDesktopBrowserControlStateSchema,
  kaiokenDesktopBrowserRevealRequestSchema,
  type KaiokenDesktopBrowserControlState,
  type KaiokenDesktopBrowserRevealRequest,
  kaiokenDesktopFederatedFetchResponseSchema,
  federatedSocketEventSchema,
  kaiokenDesktopInfoSchema,
  kaiokenDesktopWindowStateSchema,
  type KaiokenDesktopApi,
  type KaiokenDesktopAppCommandHandler,
  type KaiokenDesktopBrowserApi,
  type KaiokenDesktopBrowserFindResultHandler,
  type KaiokenDesktopBrowserOpenTabHandler,
  type KaiokenDesktopBrowserScopedOpenTabHandler,
  type KaiokenDesktopBrowserFocusHandler,
  type KaiokenDesktopBrowserSnapshotHandler,
  type KaiokenDesktopBrowserStateHandler,
  type KaiokenDesktopBrowserUnsubscribe,
  type KaiokenDesktopBrowserViewBounds,
  type KaiokenDesktopCloseWindowRequestHandler,
  type KaiokenDesktopInfo,
  type KaiokenDesktopInfoChangeHandler,
  type KaiokenDesktopInfoUnsubscribe,
  type KaiokenDesktopOpenNewTabHandler,
  type KaiokenDesktopTheme,
  type KaiokenDesktopWindowState,
  type KaiokenDesktopWindowStateChangeHandler,
} from "@kaioken/desktop-contract";
import {
  KAIOKEN_DESKTOP_CHECK_FOR_UPDATES_CHANNEL,
  KAIOKEN_DESKTOP_GET_INFO_CHANNEL,
  KAIOKEN_DESKTOP_INFO_CHANGED_CHANNEL,
  KAIOKEN_DESKTOP_INSTALL_UPDATE_CHANNEL,
  KAIOKEN_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL,
  KAIOKEN_DESKTOP_SET_THEME_CHANNEL,
} from "./desktop-update-ipc.js";
import {
  KAIOKEN_DESKTOP_FEDERATED_FETCH_CHANNEL,
  FEDERATED_SOCKET_OPEN_CHANNEL,
  FEDERATED_SOCKET_SEND_CHANNEL,
  FEDERATED_SOCKET_CLOSE_CHANNEL,
  FEDERATED_SOCKET_EVENT_CHANNEL,
} from "./desktop-federation-ipc.js";
import {
  KAIOKEN_DESKTOP_BROWSER_ATTACH_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_TARGET_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_GET_CONTROL_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_CONTROL_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_RELEASE_CONTROL_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_REVEAL_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_DETACH_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_FOCUS_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_FOCUSED_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_GO_BACK_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_GO_FORWARD_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_NAVIGATE_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_RELOAD_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_STATE_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_STOP_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_LIST_IMPORT_SOURCES_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_IMPORT_COOKIES_CHANNEL,
  KAIOKEN_DESKTOP_BROWSER_OPEN_FULL_DISK_ACCESS_SETTINGS_CHANNEL,
} from "./desktop-browser-ipc.js";
import {
  KAIOKEN_DESKTOP_APP_COMMAND_CHANNEL,
  KAIOKEN_DESKTOP_WORKSPACE_NAVIGATE_CHANNEL,
  KAIOKEN_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL,
  KAIOKEN_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL,
  KAIOKEN_DESKTOP_GET_WINDOW_STATE_CHANNEL,
  KAIOKEN_DESKTOP_OPEN_NEW_TAB_CHANNEL,
  KAIOKEN_DESKTOP_OPEN_SERVER_DAEMON_LOGS_CHANNEL,
  KAIOKEN_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
} from "./desktop-window-command-ipc.js";
import { resolveBbDesktopPlatform } from "./desktop-platform.js";

function getDesktopVersion(version: string | undefined): string {
  if (version === undefined || version.length === 0) {
    throw new Error("Desktop version must be injected at build time");
  }
  return version;
}

function createInitialDesktopInfo(): KaiokenDesktopInfo {
  return {
    downloadState: "idle",
    lastCheckedAt: null,
    latestVersion: null,
    pendingVersion: null,
    platform: resolveBbDesktopPlatform(process.platform),
    updateAvailable: false,
    updateDownloaded: false,
    version: getDesktopVersion(process.env.KAIOKEN_DESKTOP_VERSION),
  };
}

function createInitialDesktopWindowState(): KaiokenDesktopWindowState {
  return {
    isFullScreen: false,
  };
}

const listeners = new Set<KaiokenDesktopInfoChangeHandler>();
const appCommandListeners = new Set<KaiokenDesktopAppCommandHandler>();
const windowStateListeners = new Set<KaiokenDesktopWindowStateChangeHandler>();
let currentInfo = createInitialDesktopInfo();
let currentWindowState = createInitialDesktopWindowState();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(currentInfo);
  }
}

function notifyWindowStateListeners(): void {
  for (const listener of windowStateListeners) {
    listener(currentWindowState);
  }
}

function applyDesktopInfoPayload(payload: unknown): KaiokenDesktopInfo | null {
  const parsed = kaiokenDesktopInfoSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  currentInfo = parsed.data;
  notifyListeners();
  return currentInfo;
}

function applyDesktopWindowStatePayload(
  payload: unknown,
): KaiokenDesktopWindowState | null {
  const parsed = kaiokenDesktopWindowStateSchema.safeParse(payload);
  if (!parsed.success) {
    return null;
  }
  currentWindowState = parsed.data;
  notifyWindowStateListeners();
  return currentWindowState;
}

async function invokeDesktopInfo(channel: string): Promise<KaiokenDesktopInfo> {
  try {
    const payload: unknown = await ipcRenderer.invoke(channel);
    return applyDesktopInfoPayload(payload) ?? currentInfo;
  } catch {
    return currentInfo;
  }
}

async function invokeDesktopWindowState(): Promise<KaiokenDesktopWindowState> {
  try {
    const payload: unknown = await ipcRenderer.invoke(
      KAIOKEN_DESKTOP_GET_WINDOW_STATE_CHANNEL,
    );
    return applyDesktopWindowStatePayload(payload) ?? currentWindowState;
  } catch {
    return currentWindowState;
  }
}

async function invokeInstallUpdate(): Promise<void> {
  try {
    await ipcRenderer.invoke(KAIOKEN_DESKTOP_INSTALL_UPDATE_CHANNEL);
  } catch {
    return;
  }
}

const browserStateListeners = new Set<KaiokenDesktopBrowserStateHandler>();
const browserControlListeners = new Set<
  (state: KaiokenDesktopBrowserControlState) => void
>();
const browserRevealListeners = new Set<
  (request: KaiokenDesktopBrowserRevealRequest) => void
>();
const browserOpenTabListeners = new Set<KaiokenDesktopBrowserOpenTabHandler>();
const browserScopedOpenTabListeners =
  new Set<KaiokenDesktopBrowserScopedOpenTabHandler>();
const browserFocusListeners = new Set<KaiokenDesktopBrowserFocusHandler>();
const browserSnapshotListeners =
  new Set<KaiokenDesktopBrowserSnapshotHandler>();
const browserFindResultListeners =
  new Set<KaiokenDesktopBrowserFindResultHandler>();
const closeWindowRequestListeners =
  new Set<KaiokenDesktopCloseWindowRequestHandler>();
const openNewTabListeners = new Set<KaiokenDesktopOpenNewTabHandler>();

function browserViewBoundsAtWindowScale(
  bounds: KaiokenDesktopBrowserViewBounds,
): KaiokenDesktopBrowserViewBounds {
  const zoomFactor = webFrame.getZoomFactor();
  if (zoomFactor === 1) {
    return bounds;
  }
  const x = Math.round(bounds.x * zoomFactor);
  const y = Math.round(bounds.y * zoomFactor);
  return {
    x,
    y,
    width: Math.max(0, Math.round((bounds.x + bounds.width) * zoomFactor) - x),
    height: Math.max(
      0,
      Math.round((bounds.y + bounds.height) * zoomFactor) - y,
    ),
  };
}

const kaiokenBrowserApi: KaiokenDesktopBrowserApi = {
  async getTarget() {
    return kaiokenDesktopBrowserTargetSchema
      .nullable()
      .parse(await ipcRenderer.invoke(KAIOKEN_DESKTOP_BROWSER_TARGET_CHANNEL));
  },
  async getControl(tabId) {
    return kaiokenDesktopBrowserControlStateSchema.nullable().parse(
      await ipcRenderer.invoke(KAIOKEN_DESKTOP_BROWSER_GET_CONTROL_CHANNEL, {
        tabId,
      }),
    );
  },
  releaseControl(tabId) {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_RELEASE_CONTROL_CHANNEL, {
      tabId,
    });
  },
  onControl(listener) {
    browserControlListeners.add(listener);
    return () => {
      browserControlListeners.delete(listener);
    };
  },
  onReveal(listener) {
    browserRevealListeners.add(listener);
    return () => {
      browserRevealListeners.delete(listener);
    };
  },
  attach(request): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_ATTACH_CHANNEL, {
      ...request,
      bounds: browserViewBoundsAtWindowScale(request.bounds),
    });
  },
  detach(tabId): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_DETACH_CHANNEL, { tabId });
  },
  navigate(request): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_NAVIGATE_CHANNEL, request);
  },
  goBack(tabId): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_GO_BACK_CHANNEL, { tabId });
  },
  goForward(tabId): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_GO_FORWARD_CHANNEL, { tabId });
  },
  reload(tabId): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_RELOAD_CHANNEL, { tabId });
  },
  stop(tabId): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_STOP_CHANNEL, { tabId });
  },
  focus(tabId): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_FOCUS_CHANNEL, { tabId });
  },
  setBounds(request): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_SET_BOUNDS_CHANNEL, {
      ...request,
      bounds: browserViewBoundsAtWindowScale(request.bounds),
    });
  },
  setVisible(request): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_SET_VISIBLE_CHANNEL, request);
  },
  setVisibleWithoutFocus(request): void {
    ipcRenderer.send(
      KAIOKEN_DESKTOP_BROWSER_SET_VISIBLE_WITHOUT_FOCUS_CHANNEL,
      request,
    );
  },
  onState(listener): KaiokenDesktopBrowserUnsubscribe {
    browserStateListeners.add(listener);
    return () => {
      browserStateListeners.delete(listener);
    };
  },
  onOpenTab(listener): KaiokenDesktopBrowserUnsubscribe {
    browserOpenTabListeners.add(listener);
    return () => {
      browserOpenTabListeners.delete(listener);
    };
  },
  onScopedOpenTab(listener): KaiokenDesktopBrowserUnsubscribe {
    browserScopedOpenTabListeners.add(listener);
    return () => {
      browserScopedOpenTabListeners.delete(listener);
    };
  },
  onFocus(listener): KaiokenDesktopBrowserUnsubscribe {
    browserFocusListeners.add(listener);
    return () => {
      browserFocusListeners.delete(listener);
    };
  },
  onSnapshot(listener): KaiokenDesktopBrowserUnsubscribe {
    browserSnapshotListeners.add(listener);
    return () => {
      browserSnapshotListeners.delete(listener);
    };
  },
  findInPage(request): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_BROWSER_FIND_IN_PAGE_CHANNEL, request);
  },
  stopFindInPage(request): void {
    ipcRenderer.send(
      KAIOKEN_DESKTOP_BROWSER_STOP_FIND_IN_PAGE_CHANNEL,
      request,
    );
  },
  onFindResult(listener): KaiokenDesktopBrowserUnsubscribe {
    browserFindResultListeners.add(listener);
    return () => {
      browserFindResultListeners.delete(listener);
    };
  },
  async listImportSources() {
    const payload: unknown = await ipcRenderer.invoke(
      KAIOKEN_DESKTOP_BROWSER_LIST_IMPORT_SOURCES_CHANNEL,
    );
    return z
      .object({ sources: z.array(desktopBrowserImportSourceSchema) })
      .parse(payload);
  },
  async importCookies(request) {
    const payload: unknown = await ipcRenderer.invoke(
      KAIOKEN_DESKTOP_BROWSER_IMPORT_COOKIES_CHANNEL,
      request,
    );
    return desktopBrowserImportOutcomeSchema.parse(payload);
  },
  openFullDiskAccessSettings() {
    ipcRenderer.send(
      KAIOKEN_DESKTOP_BROWSER_OPEN_FULL_DISK_ACCESS_SETTINGS_CHANNEL,
    );
  },
};

const kaiokenDesktopApi: KaiokenDesktopApi = {
  browser: kaiokenBrowserApi,
  get lastCheckedAt() {
    return currentInfo.lastCheckedAt;
  },
  get latestVersion() {
    return currentInfo.latestVersion;
  },
  get pendingVersion() {
    return currentInfo.pendingVersion;
  },
  platform: resolveBbDesktopPlatform(process.platform),
  get serverDaemonLogsAvailable() {
    return currentInfo.serverDaemonLogsAvailable;
  },
  get updateAvailable() {
    return currentInfo.updateAvailable;
  },
  get updateDownloaded() {
    return currentInfo.updateDownloaded;
  },
  version: currentInfo.version,
  checkForUpdates() {
    return invokeDesktopInfo(KAIOKEN_DESKTOP_CHECK_FOR_UPDATES_CHANNEL);
  },
  async federatedFetch(request) {
    const payload: unknown = await ipcRenderer.invoke(
      KAIOKEN_DESKTOP_FEDERATED_FETCH_CHANNEL,
      request,
    );
    return kaiokenDesktopFederatedFetchResponseSchema.parse(payload);
  },
  federatedTransportVersion: 2,
  onWorkspaceNavigate(listener) {
    const handler = (_event: Electron.IpcRendererEvent, path: unknown) => {
      if (
        typeof path === "string" &&
        path.startsWith("/") &&
        !path.startsWith("//") &&
        !path.includes("\\")
      )
        listener(path);
    };
    ipcRenderer.on(KAIOKEN_DESKTOP_WORKSPACE_NAVIGATE_CHANNEL, handler);
    return () =>
      ipcRenderer.removeListener(
        KAIOKEN_DESKTOP_WORKSPACE_NAVIGATE_CHANNEL,
        handler,
      );
  },
  federatedSocket: {
    async open(request) {
      await ipcRenderer.invoke(FEDERATED_SOCKET_OPEN_CHANNEL, request);
    },
    send(request) {
      ipcRenderer.send(FEDERATED_SOCKET_SEND_CHANNEL, request);
    },
    close(request) {
      ipcRenderer.send(FEDERATED_SOCKET_CLOSE_CHANNEL, request);
    },
    subscribe(listener) {
      const handler = (_event: Electron.IpcRendererEvent, payload: unknown) => {
        const parsed = federatedSocketEventSchema.safeParse(payload);
        if (parsed.success) listener(parsed.data);
      };
      ipcRenderer.on(FEDERATED_SOCKET_EVENT_CHANNEL, handler);
      return () =>
        ipcRenderer.removeListener(FEDERATED_SOCKET_EVENT_CHANNEL, handler);
    },
  },
  getInfo() {
    return invokeDesktopInfo(KAIOKEN_DESKTOP_GET_INFO_CHANNEL);
  },
  getWindowState() {
    return invokeDesktopWindowState();
  },
  installUpdate() {
    return invokeInstallUpdate();
  },
  onChange(
    listener: KaiokenDesktopInfoChangeHandler,
  ): KaiokenDesktopInfoUnsubscribe {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  onWindowStateChange(
    listener: KaiokenDesktopWindowStateChangeHandler,
  ): KaiokenDesktopInfoUnsubscribe {
    windowStateListeners.add(listener);
    return () => {
      windowStateListeners.delete(listener);
    };
  },
  onOpenNewTab(listener): KaiokenDesktopInfoUnsubscribe {
    openNewTabListeners.add(listener);
    return () => {
      openNewTabListeners.delete(listener);
    };
  },
  onAppCommand(listener): KaiokenDesktopInfoUnsubscribe {
    appCommandListeners.add(listener);
    return () => {
      appCommandListeners.delete(listener);
    };
  },
  onCloseWindowRequest(listener): KaiokenDesktopInfoUnsubscribe {
    closeWindowRequestListeners.add(listener);
    return () => {
      closeWindowRequestListeners.delete(listener);
    };
  },
  openExternalUrl(url: string): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_OPEN_EXTERNAL_URL_CHANNEL, url);
  },
  async openServerDaemonLogs(): Promise<void> {
    await ipcRenderer.invoke(KAIOKEN_DESKTOP_OPEN_SERVER_DAEMON_LOGS_CHANNEL);
  },
  setTheme(theme: KaiokenDesktopTheme): void {
    ipcRenderer.send(KAIOKEN_DESKTOP_SET_THEME_CHANNEL, theme);
  },
};

ipcRenderer.on(
  KAIOKEN_DESKTOP_INFO_CHANGED_CHANNEL,
  (_event, payload: unknown) => {
    applyDesktopInfoPayload(payload);
  },
);

ipcRenderer.on(
  KAIOKEN_DESKTOP_WINDOW_STATE_CHANGED_CHANNEL,
  (_event, payload: unknown) => {
    applyDesktopWindowStatePayload(payload);
  },
);

ipcRenderer.on(KAIOKEN_DESKTOP_OPEN_NEW_TAB_CHANNEL, () => {
  for (const listener of openNewTabListeners) {
    listener();
  }
});

ipcRenderer.on(
  KAIOKEN_DESKTOP_APP_COMMAND_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = appCommandIdSchema.safeParse(payload);
    if (!parsed.success) return;
    for (const listener of appCommandListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(KAIOKEN_DESKTOP_CLOSE_WINDOW_REQUEST_CHANNEL, () => {
  let handled = false;
  for (const listener of closeWindowRequestListeners) {
    handled = listener() || handled;
  }
  ipcRenderer.send(KAIOKEN_DESKTOP_CLOSE_WINDOW_RESPONSE_CHANNEL, handled);
});

ipcRenderer.on(
  KAIOKEN_DESKTOP_BROWSER_STATE_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = kaiokenDesktopBrowserStateSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserStateListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  KAIOKEN_DESKTOP_BROWSER_CONTROL_CHANNEL,
  (_event, payload: unknown) => {
    const state = kaiokenDesktopBrowserControlStateSchema.safeParse(payload);
    if (!state.success) return;
    for (const listener of browserControlListeners) listener(state.data);
  },
);

ipcRenderer.on(
  KAIOKEN_DESKTOP_BROWSER_REVEAL_CHANNEL,
  (_event, payload: unknown) => {
    const request = kaiokenDesktopBrowserRevealRequestSchema.safeParse(payload);
    if (!request.success) return;
    for (const listener of browserRevealListeners) listener(request.data);
  },
);

ipcRenderer.on(
  KAIOKEN_DESKTOP_BROWSER_FOCUSED_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = kaiokenDesktopBrowserTabRefSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserFocusListeners) {
      listener(parsed.data.tabId);
    }
  },
);

ipcRenderer.on(
  KAIOKEN_DESKTOP_BROWSER_OPEN_TAB_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = kaiokenDesktopBrowserOpenTabRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserOpenTabListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  KAIOKEN_DESKTOP_BROWSER_SCOPED_OPEN_TAB_CHANNEL,
  (_event, payload: unknown) => {
    const parsed =
      kaiokenDesktopBrowserScopedOpenTabRequestSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserScopedOpenTabListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  KAIOKEN_DESKTOP_BROWSER_SNAPSHOT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = kaiokenDesktopBrowserSnapshotSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserSnapshotListeners) {
      listener(parsed.data);
    }
  },
);

ipcRenderer.on(
  KAIOKEN_DESKTOP_BROWSER_FIND_RESULT_CHANNEL,
  (_event, payload: unknown) => {
    const parsed = kaiokenDesktopBrowserFindResultSchema.safeParse(payload);
    if (!parsed.success) {
      return;
    }
    for (const listener of browserFindResultListeners) {
      listener(parsed.data);
    }
  },
);

void invokeDesktopInfo(KAIOKEN_DESKTOP_GET_INFO_CHANNEL);
void invokeDesktopWindowState();

contextBridge.exposeInMainWorld("kaiokenDesktop", kaiokenDesktopApi);
