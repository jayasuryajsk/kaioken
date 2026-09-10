import type { EnvironmentProvisionCommand } from "@kaioken/host-daemon-contract";

export interface EnvironmentProvisionRequest {
  command: EnvironmentProvisionCommand;
}
