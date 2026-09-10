import type { FeatureFlags } from "@kaioken/domain";
import type { AppSurface } from "./app-surface.js";
import {
  loadCommonConfig,
  type CommonConfig,
  type LoadCommonConfigArgs,
} from "./common.js";
import { loadDatabaseConfig, type DatabaseConfig } from "./database.js";
import { loadDevAppConfig } from "./dev-app.js";
import {
  readEnvVarWithDefault,
  readOptionalEnvVar,
  resolveEnvLoader,
} from "./env.js";
import {
  KAIOKEN_APP_URL_ENV,
  KAIOKEN_APP_SURFACE_ENV,
  KAIOKEN_APP_VERSION_ENV,
  KAIOKEN_EXTERNAL_URL_ENV,
  KAIOKEN_INHERITED_SKILLS_ROOTS_ENV,
  KAIOKEN_INFERENCE_FALLBACK_ENV,
  KAIOKEN_INFERENCE_ENV,
  KAIOKEN_MARKETPLACE_URL_ENV,
  KAIOKEN_POSTHOG_API_KEY_ENV,
  KAIOKEN_SERVER_BIND_HOST_ENV,
  KAIOKEN_SERVER_LAUNCH_ID_ENV,
  KAIOKEN_TELEMETRY_ENV,
  KAIOKEN_TRANSCRIPTION_ENV,
  DEFAULT_KAIOKEN_APP_URL,
  DEFAULT_KAIOKEN_APP_SURFACE,
  DEFAULT_KAIOKEN_APP_VERSION,
  DEFAULT_KAIOKEN_EXTERNAL_URL,
  DEFAULT_KAIOKEN_INFERENCE_FALLBACK,
  DEFAULT_KAIOKEN_INFERENCE,
  DEFAULT_KAIOKEN_MARKETPLACE_URL,
  DEFAULT_KAIOKEN_POSTHOG_API_KEY,
  DEFAULT_KAIOKEN_SERVER_BIND_HOST,
  DEFAULT_KAIOKEN_TELEMETRY,
  DEFAULT_KAIOKEN_TRANSCRIPTION,
  DEFAULT_OPENAI_API_KEY,
  OPENAI_API_KEY_ENV,
  parseServerBindHost,
  type ServerBindHost,
} from "./env-vars.js";
import { loadFeatureFlags } from "./feature-flags.js";
import { assignIfDefined } from "./objects.js";
import { loadHostDaemonPortValue } from "./ports.js";
import { loadServerPortConfig, type ServerPortConfig } from "./server-port.js";

export interface ServerConfig
  extends CommonConfig, DatabaseConfig, ServerPortConfig {
  KAIOKEN_APP_URL: string;
  KAIOKEN_APP_SURFACE: AppSurface;
  KAIOKEN_APP_VERSION: string;
  KAIOKEN_DEV_APP_PORT?: number;
  KAIOKEN_EXTERNAL_URL: string;
  KAIOKEN_HOST_DAEMON_PORT: number;
  KAIOKEN_INHERITED_SKILLS_ROOTS: string[];
  KAIOKEN_INFERENCE: string;
  KAIOKEN_INFERENCE_FALLBACK: string;
  KAIOKEN_POSTHOG_API_KEY: string;
  KAIOKEN_MARKETPLACE_URL: string;
  KAIOKEN_SERVER_BIND_HOST: ServerBindHost;
  KAIOKEN_SERVER_LAUNCH_ID?: string;
  KAIOKEN_TELEMETRY: boolean;
  KAIOKEN_TRANSCRIPTION: string;
  OPENAI_API_KEY: string;
  featureFlags: FeatureFlags;
}

type LoadServerConfigArgs = LoadCommonConfigArgs;

export { parseServerBindHost };
export type { ServerBindHost };

export function loadServerConfig(
  args: LoadServerConfigArgs = {},
): ServerConfig {
  const loader = resolveEnvLoader(args);
  const commonConfig = loadCommonConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const databaseConfig = loadDatabaseConfig({
    commonConfig,
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const serverPortConfig = loadServerPortConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
    repoRoot: args.repoRoot,
  });
  const devAppConfig = loadDevAppConfig({
    env: loader.env,
    homeDir: loader.context.homeDir,
    mode: loader.mode,
  });
  const config: ServerConfig = {
    ...commonConfig,
    ...databaseConfig,
    ...serverPortConfig,
    KAIOKEN_APP_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_APP_URL,
      definition: KAIOKEN_APP_URL_ENV,
      env: loader.env,
    }),
    KAIOKEN_APP_SURFACE: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_APP_SURFACE,
      definition: KAIOKEN_APP_SURFACE_ENV,
      env: loader.env,
    }),
    KAIOKEN_APP_VERSION: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_APP_VERSION,
      definition: KAIOKEN_APP_VERSION_ENV,
      env: loader.env,
    }),
    KAIOKEN_EXTERNAL_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_EXTERNAL_URL,
      definition: KAIOKEN_EXTERNAL_URL_ENV,
      env: loader.env,
    }),
    KAIOKEN_HOST_DAEMON_PORT: loadHostDaemonPortValue({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
      repoRoot: args.repoRoot,
    }),
    KAIOKEN_INHERITED_SKILLS_ROOTS: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: [],
      definition: KAIOKEN_INHERITED_SKILLS_ROOTS_ENV,
      env: loader.env,
    }),
    KAIOKEN_INFERENCE: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_INFERENCE,
      definition: KAIOKEN_INFERENCE_ENV,
      env: loader.env,
    }),
    KAIOKEN_INFERENCE_FALLBACK: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_INFERENCE_FALLBACK,
      definition: KAIOKEN_INFERENCE_FALLBACK_ENV,
      env: loader.env,
    }),
    KAIOKEN_MARKETPLACE_URL: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_MARKETPLACE_URL,
      definition: KAIOKEN_MARKETPLACE_URL_ENV,
      env: loader.env,
    }),
    KAIOKEN_POSTHOG_API_KEY: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_POSTHOG_API_KEY,
      definition: KAIOKEN_POSTHOG_API_KEY_ENV,
      env: loader.env,
    }),
    KAIOKEN_SERVER_BIND_HOST: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_SERVER_BIND_HOST,
      definition: KAIOKEN_SERVER_BIND_HOST_ENV,
      env: loader.env,
    }),
    KAIOKEN_TELEMETRY: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_TELEMETRY,
      definition: KAIOKEN_TELEMETRY_ENV,
      env: loader.env,
    }),
    KAIOKEN_TRANSCRIPTION: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_TRANSCRIPTION,
      definition: KAIOKEN_TRANSCRIPTION_ENV,
      env: loader.env,
    }),
    OPENAI_API_KEY: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_OPENAI_API_KEY,
      definition: OPENAI_API_KEY_ENV,
      env: loader.env,
    }),
    featureFlags: loadFeatureFlags({
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
  };

  assignIfDefined({
    key: "KAIOKEN_DEV_APP_PORT",
    target: config,
    value: devAppConfig.KAIOKEN_DEV_APP_PORT,
  });
  assignIfDefined({
    key: "KAIOKEN_SERVER_LAUNCH_ID",
    target: config,
    value: readOptionalEnvVar({
      context: loader.context,
      definition: KAIOKEN_SERVER_LAUNCH_ID_ENV,
      env: loader.env,
    }),
  });

  return config;
}
