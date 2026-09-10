import { join } from "node:path";
import { loadServerConfig } from "@kaioken/config/server";
import {
  installSafeProcessDiagnostics,
  writeSafeProcessDiagnosticReport,
} from "@kaioken/process-utils";

const serverConfig = loadServerConfig();
const diagnosticsLogsDir = join(serverConfig.KAIOKEN_DATA_DIR, "logs");

installSafeProcessDiagnostics({
  logsDir: diagnosticsLogsDir,
  processName: "server",
});

function reportStartupFailure(error: unknown): void {
  try {
    writeSafeProcessDiagnosticReport({
      kind: "startupFailure",
      logsDir: diagnosticsLogsDir,
      processName: "server",
      error,
    });
  } catch {}

  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
}

async function main(): Promise<void> {
  const serverModule = await import("./start-server.js");
  await serverModule.runServer(serverConfig);
}

void main().catch(reportStartupFailure);
