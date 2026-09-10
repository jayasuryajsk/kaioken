import { z } from "zod";
import type { KaiokenDesktopBrowserApi } from "./browser.js";
import type { AppCommandId } from "@kaioken/domain";

const isoUtcDateTimeSchema = z.iso.datetime();

const kaiokenDesktopDownloadStateSchema = z.enum([
  "idle",
  "downloading",
  "downloaded",
  "failed",
]);

export const kaiokenDesktopInfoSchema = z.object({
  downloadState: kaiokenDesktopDownloadStateSchema.optional(),
  lastCheckedAt: isoUtcDateTimeSchema.nullable(),
  latestVersion: z.string().min(1).nullable(),
  pendingVersion: z.string().min(1).nullable(),
  platform: z.enum(["macos", "linux"]),
  serverDaemonLogsAvailable: z.boolean().optional(),
  updateAvailable: z.boolean(),
  updateDownloaded: z.boolean(),
  version: z.string().min(1),
});
export type KaiokenDesktopInfo = z.infer<typeof kaiokenDesktopInfoSchema>;

export const kaiokenDesktopWindowStateSchema = z
  .object({
    isFullScreen: z.boolean(),
  })
  .strict();
export type KaiokenDesktopWindowState = z.infer<typeof kaiokenDesktopWindowStateSchema>;

export const kaiokenDesktopThemeSchema = z.enum(["system", "light", "dark"]);
export type KaiokenDesktopTheme = z.infer<typeof kaiokenDesktopThemeSchema>;

export type KaiokenDesktopInfoChangeHandler = (info: KaiokenDesktopInfo) => void;
export type KaiokenDesktopInfoUnsubscribe = () => void;
export type KaiokenDesktopWindowStateChangeHandler = (
  state: KaiokenDesktopWindowState,
) => void;
export type KaiokenDesktopOpenNewTabHandler = () => void;
export type KaiokenDesktopAppCommandHandler = (command: AppCommandId) => void;
export type KaiokenDesktopCloseWindowRequestHandler = () => boolean;

export interface KaiokenDesktopApi extends KaiokenDesktopInfo {
  browser: KaiokenDesktopBrowserApi;
  checkForUpdates(): Promise<KaiokenDesktopInfo>;
  getInfo(): Promise<KaiokenDesktopInfo>;
  getWindowState?(): Promise<KaiokenDesktopWindowState>;
  installUpdate(): Promise<void>;
  onChange(listener: KaiokenDesktopInfoChangeHandler): KaiokenDesktopInfoUnsubscribe;
  onWindowStateChange?(
    listener: KaiokenDesktopWindowStateChangeHandler,
  ): KaiokenDesktopInfoUnsubscribe;
  onOpenNewTab?(listener: KaiokenDesktopOpenNewTabHandler): KaiokenDesktopInfoUnsubscribe;
  onAppCommand?(listener: KaiokenDesktopAppCommandHandler): KaiokenDesktopInfoUnsubscribe;
  onCloseWindowRequest?(
    listener: KaiokenDesktopCloseWindowRequestHandler,
  ): KaiokenDesktopInfoUnsubscribe;
  openExternalUrl(url: string): void;
  openServerDaemonLogs?(): Promise<void>;
  setTheme(theme: KaiokenDesktopTheme): void;
}
