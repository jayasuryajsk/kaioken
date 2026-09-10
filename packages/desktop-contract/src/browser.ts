import { z } from "zod";
import {
  desktopBrowserImportSelectionSchema,
  desktopBrowserProfileSchema,
  type DesktopBrowserImportOutcome,
  type DesktopBrowserImportSource,
} from "@kaioken/host-daemon-contract";

export const KAIOKEN_DESKTOP_BROWSER_MAX_URL_LENGTH = 4096;
export const KAIOKEN_DESKTOP_BROWSER_MAX_TITLE_LENGTH = 1024;

export const kaiokenDesktopBrowserTargetSchema = z
  .object({
    hostId: z.string().min(1),
    instanceId: z.string().min(1),
    generation: z.string().min(1),
  })
  .strict();
export type KaiokenDesktopBrowserTarget = z.infer<
  typeof kaiokenDesktopBrowserTargetSchema
>;

export const kaiokenDesktopBrowserControlSchema = z
  .object({
    leaseId: z.string().min(1),
    controllerLabel: z.string().min(1),
    expiresAt: z.number().int().positive(),
  })
  .strict();
export type KaiokenDesktopBrowserControl = z.infer<
  typeof kaiokenDesktopBrowserControlSchema
>;
export const kaiokenDesktopBrowserControlStateSchema = z
  .object({
    tabId: z.string().min(1),
    threadId: z.string().min(1),
    control: kaiokenDesktopBrowserControlSchema.nullable(),
  })
  .strict();
export type KaiokenDesktopBrowserControlState = z.infer<
  typeof kaiokenDesktopBrowserControlStateSchema
>;
export const kaiokenDesktopBrowserRevealRequestSchema = z
  .object({
    tabId: z.string().min(1),
    threadId: z.string().min(1),
    desktopTarget: kaiokenDesktopBrowserTargetSchema,
  })
  .strict();
export type KaiokenDesktopBrowserRevealRequest = z.infer<
  typeof kaiokenDesktopBrowserRevealRequestSchema
>;

const kaiokenDesktopBrowserViewBoundsSchema = z
  .object({
    x: z.number().int(),
    y: z.number().int(),
    width: z.number().int().nonnegative(),
    height: z.number().int().nonnegative(),
  })
  .strict();
export type KaiokenDesktopBrowserViewBounds = z.infer<
  typeof kaiokenDesktopBrowserViewBoundsSchema
>;

export interface KaiokenDesktopBrowserViewportBounds {
  width: number;
  height: number;
}

interface ClampIntegerToRangeArgs {
  max: number;
  min: number;
  value: number;
}

interface ClampBbDesktopBrowserViewBoundsArgs {
  bounds: KaiokenDesktopBrowserViewBounds;
  viewport: KaiokenDesktopBrowserViewportBounds;
}

function clampIntegerToRange(args: ClampIntegerToRangeArgs): number {
  return Math.min(Math.max(args.value, args.min), args.max);
}

export function clampBbDesktopBrowserViewBounds(
  args: ClampBbDesktopBrowserViewBoundsArgs,
): KaiokenDesktopBrowserViewBounds {
  const viewportRight = Math.max(0, Math.round(args.viewport.width));
  const viewportBottom = Math.max(0, Math.round(args.viewport.height));
  const x = clampIntegerToRange({
    value: args.bounds.x,
    min: 0,
    max: viewportRight,
  });
  const y = clampIntegerToRange({
    value: args.bounds.y,
    min: 0,
    max: viewportBottom,
  });
  const right = clampIntegerToRange({
    value: args.bounds.x + args.bounds.width,
    min: x,
    max: viewportRight,
  });
  const bottom = clampIntegerToRange({
    value: args.bounds.y + args.bounds.height,
    min: y,
    max: viewportBottom,
  });

  return {
    x,
    y,
    width: right - x,
    height: bottom - y,
  };
}

export const kaiokenDesktopBrowserAttachRequestSchema = z
  .object({
    tabId: z.string().min(1),
    threadId: z.string().min(1),
    url: z.string().max(KAIOKEN_DESKTOP_BROWSER_MAX_URL_LENGTH),
    existingOnly: z.literal(true).optional(),
    bounds: kaiokenDesktopBrowserViewBoundsSchema,
    visible: z.boolean(),
  })
  .strict();
export type KaiokenDesktopBrowserAttachRequest = z.infer<
  typeof kaiokenDesktopBrowserAttachRequestSchema
>;

export const kaiokenDesktopBrowserNavigateRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(KAIOKEN_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type KaiokenDesktopBrowserNavigateRequest = z.infer<
  typeof kaiokenDesktopBrowserNavigateRequestSchema
>;

export const kaiokenDesktopBrowserSetBoundsRequestSchema = z
  .object({
    tabId: z.string().min(1),
    bounds: kaiokenDesktopBrowserViewBoundsSchema,
  })
  .strict();
export type KaiokenDesktopBrowserSetBoundsRequest = z.infer<
  typeof kaiokenDesktopBrowserSetBoundsRequestSchema
>;

export const kaiokenDesktopBrowserSetVisibleRequestSchema = z
  .object({
    tabId: z.string().min(1),
    visible: z.boolean(),
  })
  .strict();
export type KaiokenDesktopBrowserSetVisibleRequest = z.infer<
  typeof kaiokenDesktopBrowserSetVisibleRequestSchema
>;

export const kaiokenDesktopBrowserTabRefSchema = z
  .object({
    tabId: z.string().min(1),
  })
  .strict();
export type KaiokenDesktopBrowserTabRef = z.infer<
  typeof kaiokenDesktopBrowserTabRefSchema
>;

export const kaiokenDesktopBrowserStateSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().max(KAIOKEN_DESKTOP_BROWSER_MAX_URL_LENGTH),
    title: z.string().max(KAIOKEN_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
    isLoading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    errorText: z.string().max(KAIOKEN_DESKTOP_BROWSER_MAX_TITLE_LENGTH).nullable(),
  })
  .strict();
export type KaiokenDesktopBrowserState = z.infer<typeof kaiokenDesktopBrowserStateSchema>;

export const kaiokenDesktopBrowserOpenTabRequestSchema = z
  .object({
    url: z.string().min(1).max(KAIOKEN_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type KaiokenDesktopBrowserOpenTabRequest = z.infer<
  typeof kaiokenDesktopBrowserOpenTabRequestSchema
>;

export const kaiokenDesktopBrowserScopedOpenTabRequestSchema = z
  .object({
    tabId: z.string().min(1),
    url: z.string().min(1).max(KAIOKEN_DESKTOP_BROWSER_MAX_URL_LENGTH),
  })
  .strict();
export type KaiokenDesktopBrowserScopedOpenTabRequest = z.infer<
  typeof kaiokenDesktopBrowserScopedOpenTabRequestSchema
>;

const KAIOKEN_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH = 8_388_608;

export const kaiokenDesktopBrowserSnapshotSchema = z
  .object({
    tabId: z.string().min(1),
    dataUrl: z
      .string()
      .max(KAIOKEN_DESKTOP_BROWSER_MAX_SNAPSHOT_DATA_URL_LENGTH)
      .nullable(),
  })
  .strict();
export type KaiokenDesktopBrowserSnapshot = z.infer<
  typeof kaiokenDesktopBrowserSnapshotSchema
>;

export const KAIOKEN_DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH = 1024;

export const kaiokenDesktopBrowserFindInPageRequestSchema = z
  .object({
    tabId: z.string().min(1),
    text: z.string().min(1).max(KAIOKEN_DESKTOP_BROWSER_MAX_FIND_TEXT_LENGTH),
    forward: z.boolean(),
    newSession: z.boolean(),
  })
  .strict();
export type KaiokenDesktopBrowserFindInPageRequest = z.infer<
  typeof kaiokenDesktopBrowserFindInPageRequestSchema
>;

export const kaiokenDesktopBrowserStopFindInPageRequestSchema = z
  .object({
    tabId: z.string().min(1),
    action: z.enum(["clearSelection", "keepSelection", "activateSelection"]),
  })
  .strict();
export type KaiokenDesktopBrowserStopFindInPageRequest = z.infer<
  typeof kaiokenDesktopBrowserStopFindInPageRequestSchema
>;

export const kaiokenDesktopBrowserFindResultSchema = z
  .object({
    tabId: z.string().min(1),
    requestId: z.number().int(),
    activeMatchOrdinal: z.number().int().nonnegative(),
    matches: z.number().int().nonnegative(),
    finalUpdate: z.boolean(),
  })
  .strict();
export type KaiokenDesktopBrowserFindResult = z.infer<
  typeof kaiokenDesktopBrowserFindResultSchema
>;

export type KaiokenDesktopBrowserStateHandler = (
  state: KaiokenDesktopBrowserState,
) => void;
export type KaiokenDesktopBrowserOpenTabHandler = (
  request: KaiokenDesktopBrowserOpenTabRequest,
) => void;
export type KaiokenDesktopBrowserScopedOpenTabHandler = (
  request: KaiokenDesktopBrowserScopedOpenTabRequest,
) => void;
export type KaiokenDesktopBrowserSnapshotHandler = (
  snapshot: KaiokenDesktopBrowserSnapshot,
) => void;
export type KaiokenDesktopBrowserFocusHandler = (tabId: string) => void;
export type KaiokenDesktopBrowserFindResultHandler = (
  result: KaiokenDesktopBrowserFindResult,
) => void;
export type KaiokenDesktopBrowserUnsubscribe = () => void;

export const kaiokenDesktopBrowserImportCookiesRequestSchema =
  desktopBrowserImportSelectionSchema
    .extend({ profile: desktopBrowserProfileSchema })
    .strict();
export type KaiokenDesktopBrowserImportCookiesRequest = z.infer<
  typeof kaiokenDesktopBrowserImportCookiesRequestSchema
>;
export type KaiokenDesktopBrowserImportSourcesResult = {
  sources: DesktopBrowserImportSource[];
};
export type KaiokenDesktopBrowserImportCookiesResult = DesktopBrowserImportOutcome;

export interface KaiokenDesktopBrowserApi {
  listImportSources?(): Promise<KaiokenDesktopBrowserImportSourcesResult>;
  importCookies?(
    request: KaiokenDesktopBrowserImportCookiesRequest,
  ): Promise<KaiokenDesktopBrowserImportCookiesResult>;
  openFullDiskAccessSettings?(): void;
  getTarget?(): Promise<KaiokenDesktopBrowserTarget | null>;
  getControl?(tabId: string): Promise<KaiokenDesktopBrowserControlState | null>;
  releaseControl?(tabId: string): void;
  onControl?(
    listener: (state: KaiokenDesktopBrowserControlState) => void,
  ): KaiokenDesktopBrowserUnsubscribe;
  onReveal?(
    listener: (request: KaiokenDesktopBrowserRevealRequest) => void,
  ): KaiokenDesktopBrowserUnsubscribe;
  attach(request: KaiokenDesktopBrowserAttachRequest): void;
  detach(tabId: string): void;
  navigate(request: KaiokenDesktopBrowserNavigateRequest): void;
  goBack(tabId: string): void;
  goForward(tabId: string): void;
  reload(tabId: string): void;
  stop(tabId: string): void;
  focus?(tabId: string): void;
  setBounds(request: KaiokenDesktopBrowserSetBoundsRequest): void;
  setVisible(request: KaiokenDesktopBrowserSetVisibleRequest): void;
  setVisibleWithoutFocus?(request: KaiokenDesktopBrowserSetVisibleRequest): void;
  onState(listener: KaiokenDesktopBrowserStateHandler): KaiokenDesktopBrowserUnsubscribe;
  onOpenTab(
    listener: KaiokenDesktopBrowserOpenTabHandler,
  ): KaiokenDesktopBrowserUnsubscribe;
  onScopedOpenTab?(
    listener: KaiokenDesktopBrowserScopedOpenTabHandler,
  ): KaiokenDesktopBrowserUnsubscribe;
  onFocus?(listener: KaiokenDesktopBrowserFocusHandler): KaiokenDesktopBrowserUnsubscribe;
  onSnapshot?(
    listener: KaiokenDesktopBrowserSnapshotHandler,
  ): KaiokenDesktopBrowserUnsubscribe;
  findInPage?(request: KaiokenDesktopBrowserFindInPageRequest): void;
  stopFindInPage?(request: KaiokenDesktopBrowserStopFindInPageRequest): void;
  onFindResult?(
    listener: KaiokenDesktopBrowserFindResultHandler,
  ): KaiokenDesktopBrowserUnsubscribe;
}
