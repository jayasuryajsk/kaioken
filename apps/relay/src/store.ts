import { sha256Hex } from "./auth.js";

export const MACHINE_CODE_TTL_MS = 10 * 60 * 1000;
const SERVER_KEY = "server";
const MACHINE_PREFIX = "machine:";
const CODE_PREFIX = "code:";

export interface ServerRecord {
  credentialHash: string;
  handle: string;
  pairedAt: number;
}

export interface MachineRecord {
  credentialHash: string;
  label: string;
  createdAt: number;
}

export interface MachineListing extends MachineRecord {
  id: string;
}

export type CredentialSubject =
  | { kind: "server" }
  | { kind: "machine"; machineId: string };

export class RelayStore {
  constructor(private readonly kv: KVNamespace) {}

  getServer(): Promise<ServerRecord | null> {
    return this.kv.get<ServerRecord>(SERVER_KEY, "json");
  }

  async pairServer(handle: string, credential: string): Promise<ServerRecord> {
    const record: ServerRecord = {
      credentialHash: await sha256Hex(credential),
      handle,
      pairedAt: Date.now(),
    };
    await this.kv.put(SERVER_KEY, JSON.stringify(record));
    return record;
  }

  async unpairServer(): Promise<void> {
    await this.kv.delete(SERVER_KEY);
  }

  async isServerCredential(credential: string): Promise<boolean> {
    if (credential.length === 0) return false;
    const server = await this.getServer();
    return (
      server !== null && server.credentialHash === (await sha256Hex(credential))
    );
  }

  async createMachineCode(code: string): Promise<void> {
    await this.kv.put(
      `${CODE_PREFIX}${code}`,
      JSON.stringify({ createdAt: Date.now() }),
      { expirationTtl: Math.ceil(MACHINE_CODE_TTL_MS / 1000) },
    );
  }

  async consumeMachineCode(code: string): Promise<boolean> {
    const key = `${CODE_PREFIX}${code}`;
    const existing = await this.kv.get(key);
    if (existing === null) return false;
    await this.kv.delete(key);
    return true;
  }

  async addMachine(
    machineId: string,
    credential: string,
    label: string,
  ): Promise<MachineRecord> {
    const record: MachineRecord = {
      credentialHash: await sha256Hex(credential),
      label,
      createdAt: Date.now(),
    };
    await this.kv.put(`${MACHINE_PREFIX}${machineId}`, JSON.stringify(record));
    return record;
  }

  async removeMachine(machineId: string): Promise<boolean> {
    const key = `${MACHINE_PREFIX}${machineId}`;
    const existing = await this.kv.get(key);
    if (existing === null) return false;
    await this.kv.delete(key);
    return true;
  }

  async listMachines(): Promise<MachineListing[]> {
    const listed = await this.kv.list({ prefix: MACHINE_PREFIX });
    const machines: MachineListing[] = [];
    for (const key of listed.keys) {
      const record = await this.kv.get<MachineRecord>(key.name, "json");
      if (record !== null) {
        machines.push({ id: key.name.slice(MACHINE_PREFIX.length), ...record });
      }
    }
    return machines;
  }

  async resolveCredential(
    credential: string,
  ): Promise<CredentialSubject | null> {
    if (credential.length === 0) return null;
    const hash = await sha256Hex(credential);
    const server = await this.getServer();
    if (server !== null && server.credentialHash === hash) {
      return { kind: "server" };
    }
    for (const machine of await this.listMachines()) {
      if (machine.credentialHash === hash) {
        return { kind: "machine", machineId: machine.id };
      }
    }
    return null;
  }
}
