import { z } from "zod";
import {
  kaiokenDesktopBrowserAttachRequestSchema,
  kaiokenDesktopBrowserNavigateRequestSchema,
  kaiokenDesktopBrowserSetBoundsRequestSchema,
  kaiokenDesktopBrowserSetVisibleRequestSchema,
  kaiokenDesktopBrowserTabRefSchema,
  kaiokenDesktopBrowserFindInPageRequestSchema,
  kaiokenDesktopBrowserStopFindInPageRequestSchema,
  kaiokenDesktopBrowserStateSchema,
  kaiokenDesktopBrowserScopedOpenTabRequestSchema,
  kaiokenDesktopBrowserSnapshotSchema,
  kaiokenDesktopBrowserFindResultSchema,
} from "@kaioken/desktop-contract";

const envelope = { nonce: z.string().uuid(), serverId: z.string().uuid() };
export const workspaceBrowserCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("attach"),
    request: kaiokenDesktopBrowserAttachRequestSchema,
  }),
  z.object({
    method: z.literal("navigate"),
    request: kaiokenDesktopBrowserNavigateRequestSchema,
  }),
  z.object({
    method: z.literal("setBounds"),
    request: kaiokenDesktopBrowserSetBoundsRequestSchema,
  }),
  z.object({
    method: z.enum(["setVisible", "setVisibleWithoutFocus"]),
    request: kaiokenDesktopBrowserSetVisibleRequestSchema,
  }),
  z.object({
    method: z.enum([
      "detach",
      "goBack",
      "goForward",
      "reload",
      "stop",
      "focus",
    ]),
    request: kaiokenDesktopBrowserTabRefSchema,
  }),
  z.object({
    method: z.literal("findInPage"),
    request: kaiokenDesktopBrowserFindInPageRequestSchema,
  }),
  z.object({
    method: z.literal("stopFindInPage"),
    request: kaiokenDesktopBrowserStopFindInPageRequestSchema,
  }),
]);
export const workspaceBrowserRequestSchema = z.object({
  ...envelope,
  type: z.literal("kaioken:workspace-browser-request"),
  command: workspaceBrowserCommandSchema,
});
export const workspaceBrowserEventSchema = z.discriminatedUnion("event", [
  z.object({
    ...envelope,
    type: z.literal("kaioken:workspace-browser-event"),
    event: z.literal("state"),
    value: kaiokenDesktopBrowserStateSchema,
  }),
  z.object({
    ...envelope,
    type: z.literal("kaioken:workspace-browser-event"),
    event: z.literal("openTab"),
    value: kaiokenDesktopBrowserScopedOpenTabRequestSchema,
  }),
  z.object({
    ...envelope,
    type: z.literal("kaioken:workspace-browser-event"),
    event: z.literal("focus"),
    value: kaiokenDesktopBrowserTabRefSchema,
  }),
  z.object({
    ...envelope,
    type: z.literal("kaioken:workspace-browser-event"),
    event: z.literal("snapshot"),
    value: kaiokenDesktopBrowserSnapshotSchema,
  }),
  z.object({
    ...envelope,
    type: z.literal("kaioken:workspace-browser-event"),
    event: z.literal("findResult"),
    value: kaiokenDesktopBrowserFindResultSchema,
  }),
]);
export type WorkspaceBrowserEvent = z.infer<typeof workspaceBrowserEventSchema>;
export type WorkspaceBrowserCommand = z.infer<
  typeof workspaceBrowserCommandSchema
>;
