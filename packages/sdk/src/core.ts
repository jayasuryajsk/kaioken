import {
  createDesktopBrowsersArea,
  type ExperimentalDesktopBrowsersArea,
} from "./areas/desktop-browsers.js";
import type { KaiokenSdkContext, KaiokenSdkTransport } from "./transport.js";
import {
  createConnectionsArea,
  type ExperimentalConnectionsArea,
} from "./areas/connections.js";
import {
  createEnvironmentsArea,
  type EnvironmentsArea,
} from "./areas/environments.js";
import { createFilesArea, type FilesArea } from "./areas/files.js";
import type { GuideArea } from "./areas/guide.js";
import { createHostsArea, type HostsArea } from "./areas/hosts.js";
import { createProjectsArea, type ProjectsArea } from "./areas/projects.js";
import { createProvidersArea, type ProvidersArea } from "./areas/providers.js";
import { createPluginsArea, type PluginsArea } from "./areas/plugins.js";
import { createBbRealtimeClient } from "./realtime-client.js";
import type { KaiokenRealtime } from "./realtime-types.js";
import { createStatusArea, type StatusArea } from "./areas/status.js";
import { createCodexArea, type CodexArea } from "./areas/codex.js";
import { createSkillsArea, type SkillsArea } from "./areas/skills.js";
import { createThemeArea, type ThemeArea } from "./areas/theme.js";
import { createSystemArea, type SystemArea } from "./areas/system.js";
import { createTerminalsArea, type TerminalsArea } from "./areas/terminals.js";
import { createThreadsArea, type ThreadsArea } from "./areas/threads.js";
import {
  createThreadSectionsArea,
  type ThreadSectionsArea,
} from "./areas/thread-sections.js";

export type * from "./public-types.js";
export { createBuiltinPlanCommandTextInput } from "@kaioken/domain";

export interface CreateBbSdkArgs {
  context?: KaiokenSdkContext;
  transport: KaiokenSdkTransport;
}

export interface CreateBbSdkWithGuideArgs extends CreateBbSdkArgs {
  guide: GuideArea;
}

export interface KaiokenSdkAreas extends KaiokenRealtime {
  experimental_connections: ExperimentalConnectionsArea;
  codex: CodexArea;
  experimental_desktopBrowsers: ExperimentalDesktopBrowsersArea;
  environments: EnvironmentsArea;
  files: FilesArea;
  hosts: HostsArea;
  projects: ProjectsArea;
  plugins: PluginsArea;
  providers: ProvidersArea;
  skills: SkillsArea;
  status: StatusArea;
  system: SystemArea;
  terminals: TerminalsArea;
  theme: ThemeArea;
  threadSections: ThreadSectionsArea;
  threads: ThreadsArea;
}

export interface KaiokenSdk extends KaiokenSdkAreas {
  guide: GuideArea;
}

export function createBbSdk(args: CreateBbSdkWithGuideArgs): KaiokenSdk;
export function createBbSdk(args: CreateBbSdkArgs): KaiokenSdkAreas;
export function createBbSdk(
  args: CreateBbSdkArgs | CreateBbSdkWithGuideArgs,
): KaiokenSdkAreas | KaiokenSdk {
  const sdkContext = { transport: args.transport };
  const realtime = createBbRealtimeClient({
    transport: args.transport,
  });
  const areas: KaiokenSdkAreas = {
    experimental_connections: createConnectionsArea(sdkContext),
    codex: createCodexArea(sdkContext),
    experimental_desktopBrowsers: createDesktopBrowsersArea(sdkContext),
    environments: createEnvironmentsArea(sdkContext),
    files: createFilesArea(sdkContext),
    hosts: createHostsArea(sdkContext),
    subscribe(args) {
      return realtime.subscribe(args);
    },
    projects: createProjectsArea(sdkContext),
    plugins: createPluginsArea(sdkContext),
    providers: createProvidersArea(sdkContext),
    skills: createSkillsArea(sdkContext),
    status: createStatusArea(sdkContext),
    system: createSystemArea(sdkContext),
    terminals: createTerminalsArea(sdkContext),
    theme: createThemeArea(sdkContext),
    threadSections: createThreadSectionsArea(sdkContext),
    threads: createThreadsArea(sdkContext),
  };
  return "guide" in args ? { ...areas, guide: args.guide } : areas;
}
