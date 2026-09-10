import { createNodeBbSdk, type KaiokenSdk } from "@kaioken/sdk/node";
import type { Dispatcher } from "undici";

type CliRequestInit = RequestInit & { dispatcher?: Dispatcher };

export function cliFetch(
  input: RequestInfo | URL,
  init?: CliRequestInit,
): Promise<Response> {
  return fetch(input, init);
}

export function createCliBbSdk(baseUrl: string): KaiokenSdk {
  return createNodeBbSdk({ baseUrl, fetch: cliFetch });
}
