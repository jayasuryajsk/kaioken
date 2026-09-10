import type { ApiClient } from "@kaioken/server-contract";
import type {
  FetchImplementation,
  JsonBodyOf,
  SdkResponseLike,
} from "./response.js";

export type KaiokenSdkRuntime = "node" | "browser";

export interface KaiokenSdkTransport {
  api: ApiClient["api"];
  baseUrl: string;
  fetch: FetchImplementation;
  realtimeUrl?: string;
  runtime: KaiokenSdkRuntime;
  readJson<TResponse extends SdkResponseLike>(
    response: Promise<TResponse>,
  ): Promise<JsonBodyOf<TResponse>>;
  readVoid<TResponse extends SdkResponseLike>(
    response: Promise<TResponse>,
  ): Promise<void>;
  resolve<TResponse extends SdkResponseLike>(
    response: Promise<TResponse>,
  ): Promise<TResponse>;
  websocket?: KaiokenRealtimeSocketFactory;
}

export interface KaiokenRealtimeSocketMessageEvent {
  data: unknown;
}

export interface KaiokenRealtimeSocket {
  close(): void;
  onclose: (() => void) | null;
  onerror: (() => void) | null;
  onmessage: ((event: KaiokenRealtimeSocketMessageEvent) => void) | null;
  onopen: (() => void) | null;
  readyState: number;
  send(data: string): void;
}

export type KaiokenRealtimeSocketFactory = (url: string) => KaiokenRealtimeSocket;

export interface KaiokenSdkContext {}

export interface CreateHttpTransportArgs {
  baseUrl?: string;
  fetch?: FetchImplementation;
  realtimeUrl?: string;
  runtime: KaiokenSdkRuntime;
  websocket?: KaiokenRealtimeSocketFactory;
}
