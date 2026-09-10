import type { KaiokenSdkTransport } from "../transport.js";

export interface CreateSdkAreaArgs {
  transport: KaiokenSdkTransport;
}

type SignalRequestOptions = { init: { signal: AbortSignal } };

export function signalRequestArgs(
  signal: AbortSignal | undefined,
): [] | [SignalRequestOptions] {
  return signal === undefined ? [] : [{ init: { signal } }];
}
