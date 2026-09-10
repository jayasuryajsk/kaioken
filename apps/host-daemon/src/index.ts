import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadHostDaemonStartConfig } from "@kaioken/config/host-daemon";
import { loadHostDaemonEntrypointConfig } from "@kaioken/config/host-daemon-entrypoint";
import {
  installSafeProcessDiagnostics,
  writeSafeProcessDiagnosticReport,
} from "@kaioken/process-utils";

interface ReportStartupFailureArgs {
  diagnosticsLogsDir: string;
  error: unknown;
}

type MainFailureHandler = (error: unknown) => void;

const entrypointDir = dirname(fileURLToPath(import.meta.url));

function resolveEntrypointBridgeBundleDir(): string | undefined {
  return existsSync(join(entrypointDir, "kaioken-provider-bridge-worker.mjs"))
    ? entrypointDir
    : undefined;
}

function resolveDiagnosticsLogsDir(): string {
  const hostDaemonStartConfig = loadHostDaemonStartConfig({});

  return join(hostDaemonStartConfig.dataDir, "logs");
}

function reportStartupFailure(args: ReportStartupFailureArgs): void {
  try {
    writeSafeProcessDiagnosticReport({
      kind: "startupFailure",
      logsDir: args.diagnosticsLogsDir,
      processName: "host-daemon",
      error: args.error,
    });
  } catch {}

  const message =
    args.error instanceof Error
      ? (args.error.stack ?? args.error.message)
      : String(args.error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function runHostDaemonEntrypoint(): Promise<void> {
  const hostDaemonEntrypointConfig = loadHostDaemonEntrypointConfig();
  const hostDaemonModule = await import("./start-host-daemon.js");
  const daemon = await hostDaemonModule.startHostDaemon({
    kaiokenExecutableDirectory: hostDaemonEntrypointConfig.KAIOKEN_CLI_DIR,
    bridgeBundleDir:
      hostDaemonEntrypointConfig.KAIOKEN_BRIDGE_DIR ??
      resolveEntrypointBridgeBundleDir(),
    machineCredential: hostDaemonEntrypointConfig.KAIOKEN_CONNECT_MACHINE_CREDENTIAL,
    connectMachineId: hostDaemonEntrypointConfig.KAIOKEN_CONNECT_MACHINE_ID,
    autoUpdate: hostDaemonEntrypointConfig.KAIOKEN_HOST_DAEMON_AUTO_UPDATE,
    enrollKey: hostDaemonEntrypointConfig.KAIOKEN_HOST_ENROLL_KEY,
    hostId: hostDaemonEntrypointConfig.KAIOKEN_HOST_ID,
    hostName: hostDaemonEntrypointConfig.KAIOKEN_HOST_NAME,
    hostType: hostDaemonEntrypointConfig.KAIOKEN_HOST_TYPE,
  });
  await daemon.waitUntilStopped();
}

const entrypointPath = process.argv[1];
const isMainModule =
  typeof entrypointPath === "string" &&
  fileURLToPath(import.meta.url) === entrypointPath;

if (isMainModule) {
  const diagnosticsLogsDir = resolveDiagnosticsLogsDir();
  installSafeProcessDiagnostics({
    logsDir: diagnosticsLogsDir,
    processName: "host-daemon",
  });
  const handleMainFailure: MainFailureHandler = (error) => {
    reportStartupFailure({ diagnosticsLogsDir, error });
  };
  void runHostDaemonEntrypoint().catch(handleMainFailure);
}
