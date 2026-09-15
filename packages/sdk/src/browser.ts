import {
  createBbSdk,
  createBuiltinPlanCommandTextInput,
  type KaiokenSdk,
  type KaiokenSdkAreas,
} from "./core.js";
import { createHttpTransport } from "./transport-http.js";
import type {
  KaiokenRealtimeSocketFactory,
  KaiokenSdkContext,
  KaiokenSdkTransport,
} from "./transport.js";

export interface CreateBrowserTransportArgs {
  baseUrl?: string;
  fetch?: typeof fetch;
  realtimeUrl?: string;
  websocket?: KaiokenRealtimeSocketFactory;
}

export interface CreateBrowserBbSdkArgs extends CreateBrowserTransportArgs {
  context?: KaiokenSdkContext;
}

export type BrowserBbSdk = KaiokenSdkAreas;

export function createBrowserTransport(
  args: CreateBrowserTransportArgs = {},
): KaiokenSdkTransport {
  return createHttpTransport({
    baseUrl: args.baseUrl,
    fetch: args.fetch,
    realtimeUrl: args.realtimeUrl,
    runtime: "browser",
    websocket: args.websocket,
  });
}

export function createBrowserBbSdk(
  args: CreateBrowserBbSdkArgs = {},
): BrowserBbSdk {
  return createBbSdk({
    context: args.context,
    transport: createBrowserTransport(args),
  });
}

export const bb = createBrowserBbSdk();

export { KaiokenHttpError, KaiokenRequestTimeoutError } from "./response.js";
export type { KaiokenHttpErrorArgs } from "./response.js";
export { createBbSdk, createBuiltinPlanCommandTextInput, createHttpTransport };
export type {
  KaiokenSdk,
  KaiokenSdkAreas,
  KaiokenSdkContext,
  KaiokenSdkTransport,
};
export type {
  KaiokenRealtimeSocket,
  KaiokenRealtimeSocketFactory,
} from "./transport.js";
export type * from "./areas/skills.js";
export type * from "./public-types.js";
