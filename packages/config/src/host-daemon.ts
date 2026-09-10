import {
  readEnvVarWithDefault,
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  loadCommonConfig,
  type CommonConfig,
  type LoadCommonConfigArgs,
} from "./common.js";
import {
  KAIOKEN_APP_URL_ENV,
  KAIOKEN_DEV_APP_PORT_ENV,
  DEFAULT_KAIOKEN_APP_URL,
} from "./env-vars.js";
import { assignIfDefined } from "./objects.js";
import { loadHostDaemonPortValue } from "./ports.js";
import { validateOptionalUrl } from "./public-url.js";
import { validatePortNumber } from "./runtime.js";
import { loadServerUrlValue } from "./server-url.js";

interface HostDaemonConnectionConfig {
  KAIOKEN_APP_URL: string;
  KAIOKEN_DEV_APP_PORT?: number;
  KAIOKEN_HOST_DAEMON_PORT: number;
  KAIOKEN_SERVER_URL: string;
}

interface HostDaemonConfig extends CommonConfig, HostDaemonConnectionConfig {}

interface LoadHostDaemonConnectionConfigArgs extends EnvLoaderArgs {
  hostDaemonPort?: number;
  repoRoot?: string;
  serverUrl?: string;
}

interface LoadHostDaemonConfigArgs
  extends LoadCommonConfigArgs, LoadHostDaemonConnectionConfigArgs {}

interface HostDaemonStartConfig {
  dataDir: string;
  connectionConfig: HostDaemonConnectionConfig;
}

interface LoadHostDaemonStartConfigArgs extends LoadHostDaemonConfigArgs {
  dataDir?: string;
}

function resolveHostDaemonPort(
  args: LoadHostDaemonConnectionConfigArgs,
): number {
  if (args.hostDaemonPort !== undefined) {
    return validatePortNumber({
      name: "KAIOKEN_HOST_DAEMON_PORT",
      value: args.hostDaemonPort,
    });
  }

  return loadHostDaemonPortValue(args);
}

export function loadHostDaemonConnectionConfig(
  args: LoadHostDaemonConnectionConfigArgs = {},
): HostDaemonConnectionConfig {
  const loader = resolveEnvLoader(args);
  const config: HostDaemonConnectionConfig = {
    KAIOKEN_APP_URL: validateOptionalUrl(
      "KAIOKEN_APP_URL",
      readEnvVarWithDefault({
        context: loader.context,
        defaultValue: DEFAULT_KAIOKEN_APP_URL,
        definition: KAIOKEN_APP_URL_ENV,
        env: loader.env,
      }),
    ),
    KAIOKEN_HOST_DAEMON_PORT: resolveHostDaemonPort({
      ...args,
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
    KAIOKEN_SERVER_URL: loadServerUrlValue({
      ...args,
      env: loader.env,
      homeDir: loader.context.homeDir,
      mode: loader.mode,
    }),
  };
  const devAppPort = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_DEV_APP_PORT_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "KAIOKEN_DEV_APP_PORT",
    target: config,
    value: devAppPort,
  });

  return config;
}

export function loadHostDaemonConfig(
  args: LoadHostDaemonConfigArgs = {},
): HostDaemonConfig {
  return {
    ...loadCommonConfig(args),
    ...loadHostDaemonConnectionConfig(args),
  };
}

export function loadHostDaemonStartConfig(
  args: LoadHostDaemonStartConfigArgs,
): HostDaemonStartConfig {
  if (args.dataDir === undefined) {
    const config = loadHostDaemonConfig(args);
    return {
      connectionConfig: config,
      dataDir: config.KAIOKEN_DATA_DIR,
    };
  }

  return {
    connectionConfig: loadHostDaemonConnectionConfig(args),
    dataDir: args.dataDir,
  };
}
