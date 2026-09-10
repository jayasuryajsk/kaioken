import { createBrowserBbSdk } from "@kaioken/sdk/browser";
import { fetchWithAppSurface } from "./app-surface";

const BASE_URL =
  typeof window === "undefined" ? "http://localhost" : window.location.origin;

export const sdk = createBrowserBbSdk({
  baseUrl: BASE_URL,
  fetch: fetchWithAppSurface,
});

export { KaiokenHttpError } from "@kaioken/sdk/browser";
