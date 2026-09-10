import type { HostType } from "@kaioken/domain";
import {
  readOptionalEnvVar,
  resolveEnvLoader,
  type EnvLoaderArgs,
} from "./env.js";
import {
  KAIOKEN_BRIDGE_DIR_ENV,
  KAIOKEN_CLI_DIR_ENV,
  KAIOKEN_CONNECT_MACHINE_CREDENTIAL_ENV,
  KAIOKEN_CONNECT_MACHINE_ID_ENV,
  KAIOKEN_HOST_ENROLL_KEY_ENV,
  KAIOKEN_HOST_DAEMON_AUTO_UPDATE_ENV,
  KAIOKEN_HOST_ID_ENV,
  KAIOKEN_HOST_NAME_ENV,
  KAIOKEN_HOST_TYPE_ENV,
} from "./env-vars.js";
import { assignIfDefined } from "./objects.js";

export interface HostDaemonEntrypointConfig {
  KAIOKEN_BRIDGE_DIR?: string;
  KAIOKEN_CLI_DIR?: string;
  KAIOKEN_CONNECT_MACHINE_CREDENTIAL?: string;
  KAIOKEN_CONNECT_MACHINE_ID?: string;
  KAIOKEN_HOST_ENROLL_KEY?: string;
  KAIOKEN_HOST_DAEMON_AUTO_UPDATE?: boolean;
  KAIOKEN_HOST_ID?: string;
  KAIOKEN_HOST_NAME?: string;
  KAIOKEN_HOST_TYPE?: HostType;
}

type LoadHostDaemonEntrypointConfigArgs = EnvLoaderArgs;

export function loadHostDaemonEntrypointConfig(
  args: LoadHostDaemonEntrypointConfigArgs = {},
): HostDaemonEntrypointConfig {
  const loader = resolveEnvLoader(args);
  const config: HostDaemonEntrypointConfig = {};
  const bridgeDir = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_BRIDGE_DIR_ENV,
    env: loader.env,
  });
  const cliDir = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_CLI_DIR_ENV,
    env: loader.env,
  });
  const enrollKey = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_HOST_ENROLL_KEY_ENV,
    env: loader.env,
  });
  const autoUpdate = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_HOST_DAEMON_AUTO_UPDATE_ENV,
    env: loader.env,
  });
  const machineCredential = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_CONNECT_MACHINE_CREDENTIAL_ENV,
    env: loader.env,
  });
  const connectMachineId = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_CONNECT_MACHINE_ID_ENV,
    env: loader.env,
  });
  const hostId = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_HOST_ID_ENV,
    env: loader.env,
  });
  const hostName = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_HOST_NAME_ENV,
    env: loader.env,
  });
  const hostType = readOptionalEnvVar({
    context: loader.context,
    definition: KAIOKEN_HOST_TYPE_ENV,
    env: loader.env,
  });

  assignIfDefined({
    key: "KAIOKEN_BRIDGE_DIR",
    target: config,
    value: bridgeDir,
  });
  assignIfDefined({
    key: "KAIOKEN_CONNECT_MACHINE_ID",
    target: config,
    value: connectMachineId,
  });
  assignIfDefined({
    key: "KAIOKEN_CLI_DIR",
    target: config,
    value: cliDir,
  });
  assignIfDefined({
    key: "KAIOKEN_CONNECT_MACHINE_CREDENTIAL",
    target: config,
    value: machineCredential,
  });
  assignIfDefined({
    key: "KAIOKEN_HOST_DAEMON_AUTO_UPDATE",
    target: config,
    value: autoUpdate,
  });
  assignIfDefined({
    key: "KAIOKEN_HOST_ENROLL_KEY",
    target: config,
    value: enrollKey,
  });
  assignIfDefined({
    key: "KAIOKEN_HOST_ID",
    target: config,
    value: hostId,
  });
  assignIfDefined({
    key: "KAIOKEN_HOST_NAME",
    target: config,
    value: hostName,
  });
  assignIfDefined({
    key: "KAIOKEN_HOST_TYPE",
    target: config,
    value: hostType,
  });

  return config;
}
