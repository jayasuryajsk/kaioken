import type { QueryClient } from "@tanstack/react-query";
import type { BrowserBbSdk } from "@kaioken/sdk/browser";
import { sdk as localSdk } from "@/lib/sdk";

const sdkByQueryClient = new WeakMap<QueryClient, BrowserBbSdk>();

export function registerQueryClientSdk(
  queryClient: QueryClient,
  sdk: BrowserBbSdk,
): void {
  sdkByQueryClient.set(queryClient, sdk);
}

export function sdkForQueryClient(queryClient: QueryClient): BrowserBbSdk {
  return sdkByQueryClient.get(queryClient) ?? localSdk;
}
