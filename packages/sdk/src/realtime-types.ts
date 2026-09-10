import type { ChangedMessage } from "@kaioken/domain";

export type KaiokenRealtimeUnsubscribe = () => void;

export type KaiokenRealtimeEventName =
  | "thread:changed"
  | "project:changed"
  | "environment:changed"
  | "host:changed"
  | "system:changed"
  | "system:config-changed"
  | "realtime:connection";

export type ThreadRealtimeEvent = Extract<ChangedMessage, { entity: "thread" }>;
export type ProjectRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "project" }
>;
export type EnvironmentRealtimeEvent = Extract<
  ChangedMessage,
  { entity: "environment" }
>;
export type HostRealtimeEvent = Extract<ChangedMessage, { entity: "host" }>;
export type SystemRealtimeEvent = Extract<ChangedMessage, { entity: "system" }>;

export type KaiokenRealtimeConnectionState =
  | "connecting"
  | "connected"
  | "disconnected";

export interface KaiokenRealtimeConnectionEvent {
  reconnectDelayMs: number | null;
  reconnected: boolean;
  state: KaiokenRealtimeConnectionState;
}

export interface KaiokenRealtimeEventMap {
  "thread:changed": ThreadRealtimeEvent;
  "project:changed": ProjectRealtimeEvent;
  "environment:changed": EnvironmentRealtimeEvent;
  "host:changed": HostRealtimeEvent;
  "system:changed": SystemRealtimeEvent;
  "system:config-changed": SystemRealtimeEvent;
  "realtime:connection": KaiokenRealtimeConnectionEvent;
}

export type KaiokenRealtimeCallback<TEventName extends KaiokenRealtimeEventName> = (
  event: KaiokenRealtimeEventMap[TEventName],
) => void;

export interface ThreadRealtimeSubscribeArgs {
  callback: KaiokenRealtimeCallback<"thread:changed">;
  event: "thread:changed";
  threadId?: string;
}

export interface ProjectRealtimeSubscribeArgs {
  callback: KaiokenRealtimeCallback<"project:changed">;
  event: "project:changed";
  projectId?: string;
}

export interface EnvironmentRealtimeSubscribeArgs {
  callback: KaiokenRealtimeCallback<"environment:changed">;
  environmentId?: string;
  event: "environment:changed";
}

export interface HostRealtimeSubscribeArgs {
  callback: KaiokenRealtimeCallback<"host:changed">;
  event: "host:changed";
  hostId?: string;
}

export interface SystemRealtimeSubscribeArgs {
  callback: KaiokenRealtimeCallback<"system:changed">;
  event: "system:changed";
}

export interface SystemConfigRealtimeSubscribeArgs {
  callback: KaiokenRealtimeCallback<"system:config-changed">;
  event: "system:config-changed";
}

export interface RealtimeConnectionSubscribeArgs {
  callback: KaiokenRealtimeCallback<"realtime:connection">;
  event: "realtime:connection";
}

export type KaiokenRealtimeSubscribeArgsUnion =
  | ThreadRealtimeSubscribeArgs
  | ProjectRealtimeSubscribeArgs
  | EnvironmentRealtimeSubscribeArgs
  | HostRealtimeSubscribeArgs
  | SystemRealtimeSubscribeArgs
  | SystemConfigRealtimeSubscribeArgs
  | RealtimeConnectionSubscribeArgs;

export type KaiokenRealtimeSubscribeArgs<
  TEventName extends KaiokenRealtimeEventName = KaiokenRealtimeEventName,
> = Extract<KaiokenRealtimeSubscribeArgsUnion, { event: TEventName }>;

export interface KaiokenRealtime {
  subscribe<TEventName extends KaiokenRealtimeEventName>(
    args: KaiokenRealtimeSubscribeArgs<TEventName>,
  ): KaiokenRealtimeUnsubscribe;
}
