import type {
  KaiokenDesktopApi,
  KaiokenDesktopBrowserApi,
  KaiokenDesktopInfo,
} from "@kaioken/desktop-contract";

export function createNoopDesktopBrowserApi(): KaiokenDesktopBrowserApi {
  return {
    attach() {},
    detach() {},
    navigate() {},
    goBack() {},
    goForward() {},
    reload() {},
    stop() {},
    focus() {},
    setBounds() {},
    setVisible() {},
    setVisibleWithoutFocus() {},
    onState() {
      return () => {};
    },
    onOpenTab() {
      return () => {};
    },
    onFocus() {
      return () => {};
    },
  };
}

export function createBbDesktopApi(
  info: KaiokenDesktopInfo,
  browser: KaiokenDesktopBrowserApi = createNoopDesktopBrowserApi(),
): KaiokenDesktopApi {
  return {
    ...info,
    browser,
    async checkForUpdates() {
      return info;
    },
    async getInfo() {
      return info;
    },
    async installUpdate() {},
    onChange() {
      return () => {};
    },
    setTheme() {},
    openExternalUrl() {},
  };
}
