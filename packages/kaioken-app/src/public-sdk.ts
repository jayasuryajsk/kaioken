import {
  KaiokenHttpError,
  KaiokenRequestTimeoutError,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
  createNodeBbSdk,
  type KaiokenSdk,
  type CreateNodeBbSdkArgs,
} from "@kaioken/sdk/node";
import type {
  KaiokenRealtimeSubscribeArgs,
  KaiokenRealtimeSocket,
  KaiokenRealtimeSocketFactory,
  KaiokenRealtimeSocketMessageEvent,
  ThreadGetResult,
  ThreadStatusArgs,
} from "@kaioken/sdk/node";

export {
  KaiokenHttpError,
  KaiokenRequestTimeoutError,
  ThreadWaitTimeoutError,
  ThreadWaitUnreachableError,
};
export type * from "@kaioken/sdk/node";
export type {
  GitBranchSelection,
  JsonValue,
  PermissionMode,
  PromptInput,
  PromptTextMention,
  ReasoningLevel,
  ServiceTier,
  ThreadStatus,
} from "@kaioken/sdk/node";
export type {
  CreateExecutionInputSources,
  EnvironmentArgs,
  ExistingThreadExecutionInputSources,
  UnmanagedBranchSpec,
  WorkspaceArgs,
} from "@kaioken/sdk/node";
export type { CallerExecutionInputSource as ExecutionInputSource } from "@kaioken/sdk/node";

export type BBSdkOptions = CreateNodeBbSdkArgs;
export type BBSdkRealtimeSubscribeArgs = KaiokenRealtimeSubscribeArgs;
export type BBSdkRealtimeSocket = KaiokenRealtimeSocket;
export type BBSdkRealtimeSocketFactory = KaiokenRealtimeSocketFactory;
export type BBSdkRealtimeSocketMessageEvent = KaiokenRealtimeSocketMessageEvent;
export type BBSdkStatusArea = KaiokenSdk["status"];
export type BBSdkSkillsArea = KaiokenSdk["skills"];
export type BBSdkTerminalsArea = KaiokenSdk["terminals"];
export type BBSdkThread = ThreadGetResult;
export type BBSdkThreadsArea = KaiokenSdk["threads"];
export type ThreadIdArgs = ThreadStatusArgs;
export type KaiokenHttpErrorConstructor = typeof KaiokenHttpError;
export type KaiokenRequestTimeoutErrorConstructor = typeof KaiokenRequestTimeoutError;
export type ThreadWaitTimeoutErrorConstructor = typeof ThreadWaitTimeoutError;
export type ThreadWaitUnreachableErrorConstructor =
  typeof ThreadWaitUnreachableError;

export class BBSdk implements KaiokenSdk {
  readonly environments: KaiokenSdk["environments"];
  readonly experimental_desktopBrowsers: KaiokenSdk["experimental_desktopBrowsers"];
  readonly files: KaiokenSdk["files"];
  readonly guide: KaiokenSdk["guide"];
  readonly hosts: KaiokenSdk["hosts"];
  readonly plugins: KaiokenSdk["plugins"];
  readonly projects: KaiokenSdk["projects"];
  readonly providers: KaiokenSdk["providers"];
  readonly skills: KaiokenSdk["skills"];
  readonly status: KaiokenSdk["status"];
  readonly system: KaiokenSdk["system"];
  readonly terminals: KaiokenSdk["terminals"];
  readonly theme: KaiokenSdk["theme"];
  readonly threadSections: KaiokenSdk["threadSections"];
  readonly threads: KaiokenSdk["threads"];
  readonly subscribe: KaiokenSdk["subscribe"];

  constructor(options: BBSdkOptions = {}) {
    const sdk = createNodeBbSdk(options);
    this.environments = sdk.environments;
    this.experimental_desktopBrowsers = sdk.experimental_desktopBrowsers;
    this.files = sdk.files;
    this.guide = sdk.guide;
    this.hosts = sdk.hosts;
    this.plugins = sdk.plugins;
    this.projects = sdk.projects;
    this.providers = sdk.providers;
    this.skills = sdk.skills;
    this.status = sdk.status;
    this.system = sdk.system;
    this.terminals = sdk.terminals;
    this.theme = sdk.theme;
    this.threadSections = sdk.threadSections;
    this.threads = sdk.threads;
    this.subscribe = sdk.subscribe;
  }
}

export function createBBSdk(options: BBSdkOptions = {}): BBSdk {
  return new BBSdk(options);
}
