type ConnectPublicProtocol = "http:" | "https:";

const SINGLE_HOST_SUFFIXES = [".workers.dev"];

export function isSingleHostRelay(hostname: string): boolean {
  const lower = hostname.toLowerCase();
  return SINGLE_HOST_SUFFIXES.some((suffix) => lower.endsWith(suffix));
}

export function connectPublicProtocol(
  baseDomain: string,
): ConnectPublicProtocol {
  const hostname = new URL(`https://${baseDomain}`).hostname;
  return hostname.endsWith(".localhost") ? "http:" : "https:";
}

export function deriveConnectBaseUrl(serverUrl: string): string {
  const url = new URL(serverUrl);
  if (isSingleHostRelay(url.hostname)) return url.origin;
  return url.origin.replace(/\/\/[^.]+\./, "//");
}

export function serverUrlForHandle(baseUrl: string, handle: string): string {
  const url = new URL(baseUrl);
  if (isSingleHostRelay(url.hostname)) return url.origin;
  return `${url.protocol}//${handle}.${url.host}`;
}
