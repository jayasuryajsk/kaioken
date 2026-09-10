import {
  readEnvVarWithDefault,
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  KAIOKEN_DEV_APP_HOST_ENV,
  KAIOKEN_DEV_APP_PORT_ENV,
  DEFAULT_KAIOKEN_DEV_APP_HOST,
} from "./env-vars.js";
import { assignIfDefined } from "./objects.js";

interface DevAppConfig {
  KAIOKEN_DEV_APP_HOST: string;
  KAIOKEN_DEV_APP_PORT?: number;
}

type LoadDevAppConfigArgs = EnvLoaderArgs;

export function loadDevAppConfig(
  args: LoadDevAppConfigArgs = {},
): DevAppConfig {
  const loader = resolveEnvLoader(args);
  const config: DevAppConfig = {
    KAIOKEN_DEV_APP_HOST: readEnvVarWithDefault({
      context: loader.context,
      defaultValue: DEFAULT_KAIOKEN_DEV_APP_HOST,
      definition: KAIOKEN_DEV_APP_HOST_ENV,
      env: loader.env,
    }),
  };
  const appPort = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_DEV_APP_PORT_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "KAIOKEN_DEV_APP_PORT",
    target: config,
    value: appPort,
  });

  return config;
}
