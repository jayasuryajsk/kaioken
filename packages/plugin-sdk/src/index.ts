/**
 * `@get-kaioken/plugin-sdk` — the typed facade plugin authors compile against.
 *
 * The root export carries the side-effect-free app and host-contract types
 * plus the backend contract (`KaiokenPluginApi`, the
 * `server.ts` factory argument — types only, implemented by the Kaioken server).
 * The `./app` subpath adds the runtime bindings that `kaioken plugin build` shims
 * to the host's shared runtime.
 */
export * from "./app-contract.js";
export * from "./backend-contract.js";
export * from "./host-contract.js";
export type * from "./json-value.js";
export * from "./rpc-contract.js";
export type {
  ExperimentalDesktopBrowsersArea,
  ExperimentalDesktopBrowserScope,
  ExperimentalDesktopBrowserLease,
  ExperimentalDesktopBrowserCreateInput,
  ExperimentalDesktopBrowserAcquireInput,
} from "@kaioken/sdk";
