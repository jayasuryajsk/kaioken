import { resolveEnvLoader, type EnvLoaderArgs } from "./env.js";
import { loadHostDaemonPortValue } from "./ports.js";
import {
  KAIOKEN_LOOPBACK_HOST,
  KAIOKEN_PROD_HOST_DAEMON_PORT,
  KAIOKEN_PROD_SERVER_PORT,
} from "./runtime.js";
import { loadServerUrlValue } from "./server-url.js";

export interface CliConfig {
  KAIOKEN_HOST_DAEMON_PORT: number;
  KAIOKEN_SERVER_URL: string;
}

interface LoadCliConfigArgs extends EnvLoaderArgs {
  repoRoot?: string;
}

const DEFAULT_CLI_SERVER_URL = `http://${KAIOKEN_LOOPBACK_HOST}:${KAIOKEN_PROD_SERVER_PORT}`;

function hasConfiguredValue(env: NodeJS.ProcessEnv, key: string): boolean {
  return env[key] !== undefined;
}

export function loadCliConfig(args: LoadCliConfigArgs = {}): CliConfig {
  const loader = resolveEnvLoader(args);
  const useDevDefaults = loader.mode === "dev" && args.repoRoot !== undefined;
  const serverUrl =
    hasConfiguredValue(loader.env, "KAIOKEN_SERVER_URL") || useDevDefaults
      ? loadServerUrlValue({
          ...args,
          env: loader.env,
          homeDir: loader.context.homeDir,
          mode: loader.mode,
        })
      : loadServerUrlValue({
          ...args,
          env: loader.env,
          homeDir: loader.context.homeDir,
          mode: loader.mode,
          serverUrl: DEFAULT_CLI_SERVER_URL,
        });

  return {
    KAIOKEN_HOST_DAEMON_PORT:
      hasConfiguredValue(loader.env, "KAIOKEN_HOST_DAEMON_PORT") || useDevDefaults
        ? loadHostDaemonPortValue({
            ...args,
            env: loader.env,
            homeDir: loader.context.homeDir,
            mode: loader.mode,
          })
        : KAIOKEN_PROD_HOST_DAEMON_PORT,
    KAIOKEN_SERVER_URL: serverUrl,
  };
}
