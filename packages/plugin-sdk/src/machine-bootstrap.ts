import type {
  ServerAccessGrant,
  ServerAccessSelection,
} from "./backend-contract.js";
import type { PluginMachineProviderProgress } from "./machine-provider.js";

export interface EnrollmentBootstrap {
  hostId: string;
  serverUrl: string;
  headers?: ServerAccessGrant["headers"];
  credential: string;
  expiresAt: number;
}

export type MachineEnrollment =
  | {
      id: string;
      hostId: string;
      state: "pending";
      bootstrap: EnrollmentBootstrap;
    }
  | { id: string; hostId: string; state: "enrolled" };

export interface MachineExecutorRequest {
  command: string[];
  timeoutMs: number;
  signal: AbortSignal;
  stdin?: string;
}

export interface MachineExecutor {
  exec(
    request: MachineExecutorRequest,
  ): Promise<{ exitCode: number; stdout: string; stderr: string }>;
}

export interface MachineEnrollmentRequest {
  key: string;
  access?: ServerAccessSelection;
}

export interface MachineConnectionRequest {
  enrollmentId: string;
  timeoutMs: number;
  signal: AbortSignal;
}

export interface MachineEnrollments {
  prepare(request: MachineEnrollmentRequest): Promise<MachineEnrollment>;
  waitForConnection(
    request: MachineConnectionRequest,
  ): Promise<{ hostId: string }>;
}

export interface MachineBootstrapRequest extends MachineEnrollmentRequest {
  executor: MachineExecutor;
  report: PluginMachineProviderProgress;
  signal: AbortSignal;
}

export interface MachineBootstrapApi {
  enrollments: MachineEnrollments;
  bootstrap(request: MachineBootstrapRequest): Promise<{ hostId: string }>;
}
