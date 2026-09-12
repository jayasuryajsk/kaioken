import { sha256Hex } from "./auth.js";

export const MACHINE_CODE_TTL_MS = 10 * 60 * 1000;
const EXISTENCE_CACHE_MS = 60 * 1000;
const SERVER_KEY = "server";
const MACHINE_PREFIX = "machine:";
const CODE_PREFIX = "code:";
const TOKEN_PREFIX = "token:";

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

const existenceCache = new Map<
  string,
  { exists: boolean; checkedAt: number }
>();

export class RelayStore {
  constructor(private readonly kv: KVNamespace) {}

  getServer(): Promise<ServerRecord | null> {
    return this.kv.get<ServerRecord>(SERVER_KEY, "json");
  }

  async pairServer(handle: string, credential: string): Promise<ServerRecord> {
    const previous = await this.getServer();
    if (previous !== null) {
      await this.kv.delete(`${TOKEN_PREFIX}${previous.credentialHash}`);
    }
    const record: ServerRecord = {
      credentialHash: await sha256Hex(credential),
      handle,
      pairedAt: Date.now(),
    };
    await this.kv.put(SERVER_KEY, JSON.stringify(record));
    await this.kv.put(
      `${TOKEN_PREFIX}${record.credentialHash}`,
      JSON.stringify({ kind: "server" } satisfies CredentialSubject),
    );
    return record;
  }

  async unpairServer(): Promise<void> {
    const previous = await this.getServer();
    if (previous !== null) {
      await this.kv.delete(`${TOKEN_PREFIX}${previous.credentialHash}`);
    }
    await this.kv.delete(SERVER_KEY);
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
    await this.kv.put(
      `${TOKEN_PREFIX}${record.credentialHash}`,
      JSON.stringify({
        kind: "machine",
        machineId,
      } satisfies CredentialSubject),
    );
    existenceCache.set(machineId, { exists: true, checkedAt: Date.now() });
    return record;
  }

  async removeMachine(machineId: string): Promise<boolean> {
    const key = `${MACHINE_PREFIX}${machineId}`;
    const record = await this.kv.get<MachineRecord>(key, "json");
    if (record === null) return false;
    await this.kv.delete(key);
    await this.kv.delete(`${TOKEN_PREFIX}${record.credentialHash}`);
    existenceCache.set(machineId, { exists: false, checkedAt: Date.now() });
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

  async machineExists(machineId: string): Promise<boolean> {
    const cached = existenceCache.get(machineId);
    const now = Date.now();
    if (cached !== undefined && now - cached.checkedAt < EXISTENCE_CACHE_MS) {
      return cached.exists;
    }
    const exists =
      (await this.kv.get(`${MACHINE_PREFIX}${machineId}`)) !== null;
    existenceCache.set(machineId, { exists, checkedAt: now });
    return exists;
  }

  async resolveCredential(
    credential: string,
  ): Promise<CredentialSubject | null> {
    if (credential.length === 0) return null;
    const hash = await sha256Hex(credential);
    const indexed = await this.kv.get<CredentialSubject>(
      `${TOKEN_PREFIX}${hash}`,
      "json",
    );
    if (indexed !== null) return indexed;
    return this.backfillTokenIndex(hash);
  }

  private async backfillTokenIndex(
    hash: string,
  ): Promise<CredentialSubject | null> {
    const server = await this.getServer();
    if (server !== null && server.credentialHash === hash) {
      const subject: CredentialSubject = { kind: "server" };
      await this.kv.put(`${TOKEN_PREFIX}${hash}`, JSON.stringify(subject));
      return subject;
    }
    for (const machine of await this.listMachines()) {
      if (machine.credentialHash === hash) {
        const subject: CredentialSubject = {
          kind: "machine",
          machineId: machine.id,
        };
        await this.kv.put(`${TOKEN_PREFIX}${hash}`, JSON.stringify(subject));
        return subject;
      }
    }
    return null;
  }
}
