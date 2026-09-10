import type { KaiokenDesktopApi } from "@kaioken/desktop-contract";

declare global {
  interface Window {
    kaiokenDesktop?: KaiokenDesktopApi;
  }
}

export {};
