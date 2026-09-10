import type { MachineBootstrapApi } from "@get-bb/plugin-sdk";
import type { EnrollmentBootstrap, MachineEnrollments } from "./enrollments.js";
import { readFile } from "node:fs/promises";
import { INSTALL_MACHINE_SCRIPT_PATH } from "../../install-machine-asset.js";

const installerScript = `
set -eu
umask 077
BB_ENROLLMENT=$(cat)
export BB_ENROLLMENT
installer_url=$1
installer_file=$(mktemp)
trap 'rm -f "$installer_file"' EXIT HUP INT TERM
node -e 'for (const [name,value] of Object.entries(JSON.parse(process.env.BB_ENROLLMENT).headers ?? {})) console.log("header = " + JSON.stringify(name + ": " + value))' | curl --config - --fail --silent --show-error --location --connect-timeout 10 --max-time 60 "$installer_url" > "$installer_file"
sh "$installer_file" --bootstrap-env BB_ENROLLMENT
`;

function installerCommand(bootstrap: EnrollmentBootstrap) {
  return {
    command: [
      "sh",
      "-c",
      installerScript,
      "bb-machine-install",
      new URL("/install.sh", bootstrap.serverUrl).href,
    ],
    stdin: JSON.stringify(bootstrap),
  };
}

const installerSource = readFile(INSTALL_MACHINE_SCRIPT_PATH, "utf8");

async function installerStartCommand(hostId: string) {
  return {
    command: ["sh", "-s", "--", "--start", "--host-id", hostId],
    stdin: await installerSource,
  };
}

export function createMachineBootstrapApi(
  enrollments: MachineEnrollments,
): MachineBootstrapApi {
  return {
    async bootstrap(request) {
      request.signal.throwIfAborted();
      request.report.step("Preparing machine enrollment");
      const enrollment = await enrollments.prepare({
        key: request.key,
        access: request.access,
      });
      try {
        request.signal.throwIfAborted();
        request.report.step(
          request.executor === undefined
            ? "Run the enrollment command shown below"
            : enrollment.state === "enrolled"
              ? "Starting enrolled machine"
              : "Bootstrapping machine",
        );
        if (request.executor) {
          const execution = await (enrollment.state === "enrolled"
            ? installerStartCommand(enrollment.hostId)
            : installerCommand(enrollment.bootstrap));
          try {
            const result = await request.executor.exec({
              ...execution,
              timeoutMs: 600_000,
              signal: request.signal,
            });
            if (result.exitCode !== 0)
              throw new Error("Machine bootstrap command failed");
          } catch {
            request.signal.throwIfAborted();
            throw new Error("Machine bootstrap command failed");
          }
        }
        request.signal.throwIfAborted();
        if (request.executor !== undefined)
          request.report.step("Waiting for machine connection");
        await enrollments.waitForConnection({
          enrollmentId: enrollment.id,
          timeoutMs: request.executor ? 120_000 : 15 * 60_000,
          signal: request.signal,
        });
        return { hostId: enrollment.hostId };
      } catch (error) {
        enrollments.clearPending(request.key);
        throw error;
      }
    },
  };
}
