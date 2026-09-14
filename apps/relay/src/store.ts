import { sha256Hex } from "./auth.js";

export const MACHINE_CODE_TTL_MS = 10 * 60 * 1000;
const EXISTENCE_CACHE_MS = 60 * 1000;
const LEGACY_SERVER_KEY = "server";
const SERVER_PREFIX = "server:";
const MACHINE_PREFIX = "machine:";
const CODE_PREFIX = "code:";
const TOKEN_PREFIX = "token:";

export const HANDLE_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/u;
const RESERVED_HANDLES = new Set([
  "www",
  "api",
  "mail",
  "admin",
  "relay",
  "static",
  "cdn",
]);

export function isValidHandle(handle: string): boolean {
  return HANDLE_PATTERN.test(handle) && !RESERVED_HANDLES.has(handle);
}

export interface ServerRecord {
  credentialHash: string;
  handle: string;
  name: string;
  pairedAt: number;
}

interface LegacyServerRecord {
  credentialHash: string;
  handle?: string;
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
  | { kind: "server"; handle: string }
  | { kind: "machine"; machineId: string };

type StoredSubject =
  | { kind: "server"; handle?: string }
  | { kind: "machine"; machineId: string };

const existenceCache = new Map<
  string,
  { exists: boolean; checkedAt: number }
>();

export class RelayStore {
  private migrated: Promise<void> | null = null;

  constructor(
    private readonly kv: KVNamespace,
    private readonly legacyHandle: string,
  ) {}

  private migrate(): Promise<void> {
    this.migrated ??= this.migrateLegacyServer();
    return this.migrated;
  }

  private async migrateLegacyServer(): Promise<void> {
    const legacy = await this.kv.get<LegacyServerRecord>(
      LEGACY_SERVER_KEY,
      "json",
    );
    if (legacy === null) return;
    const handle =
      typeof legacy.handle === "string" && isValidHandle(legacy.handle)
        ? legacy.handle
        : this.legacyHandle;
    const existing = await this.kv.get<ServerRecord>(
      `${SERVER_PREFIX}${handle}`,
      "json",
    );
    if (existing === null) {
      const record: ServerRecord = {
        credentialHash: legacy.credentialHash,
        handle,
        name: "Kaioken",
        pairedAt: legacy.pairedAt,
      };
      await this.kv.put(`${SERVER_PREFIX}${handle}`, JSON.stringify(record));
      await this.kv.put(
        `${TOKEN_PREFIX}${legacy.credentialHash}`,
        JSON.stringify({ kind: "server", handle } satisfies CredentialSubject),
      );
    }
    await this.kv.delete(LEGACY_SERVER_KEY);
  }

  async getServer(handle: string): Promise<ServerRecord | null> {
    await this.migrate();
    return this.kv.get<ServerRecord>(`${SERVER_PREFIX}${handle}`, "json");
  }

  async listServers(): Promise<ServerRecord[]> {
    await this.migrate();
    const listed = await this.kv.list({ prefix: SERVER_PREFIX });
    const servers: ServerRecord[] = [];
    for (const key of listed.keys) {
      const record = await this.kv.get<ServerRecord>(key.name, "json");
      if (record !== null) servers.push(record);
    }
    return servers.sort((left, right) => left.pairedAt - right.pairedAt);
  }

  async pairServer(
    handle: string,
    name: string,
    credential: string,
  ): Promise<ServerRecord> {
    const previous = await this.getServer(handle);
    if (previous !== null) {
      await this.kv.delete(`${TOKEN_PREFIX}${previous.credentialHash}`);
    }
    const record: ServerRecord = {
      credentialHash: await sha256Hex(credential),
      handle,
      name,
      pairedAt: Date.now(),
    };
    await this.kv.put(`${SERVER_PREFIX}${handle}`, JSON.stringify(record));
    await this.kv.put(
      `${TOKEN_PREFIX}${record.credentialHash}`,
      JSON.stringify({ kind: "server", handle } satisfies CredentialSubject),
    );
    return record;
  }

  async unpairServer(handle: string): Promise<boolean> {
    const previous = await this.getServer(handle);
    if (previous === null) return false;
    await this.kv.delete(`${TOKEN_PREFIX}${previous.credentialHash}`);
    await this.kv.delete(`${SERVER_PREFIX}${handle}`);
    return true;
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
    await this.migrate();
    const hash = await sha256Hex(credential);
    const indexed = await this.kv.get<StoredSubject>(
      `${TOKEN_PREFIX}${hash}`,
      "json",
    );
    if (indexed !== null) {
      if (indexed.kind === "machine") return indexed;
      if (typeof indexed.handle === "string") {
        return { kind: "server", handle: indexed.handle };
      }
      const subject = await this.serverSubjectForHash(hash);
      if (subject !== null) return subject;
      return { kind: "server", handle: this.legacyHandle };
    }
    return this.backfillTokenIndex(hash);
  }

  private async serverSubjectForHash(
    hash: string,
  ): Promise<CredentialSubject | null> {
    for (const server of await this.listServers()) {
      if (server.credentialHash === hash) {
        const subject: CredentialSubject = {
          kind: "server",
          handle: server.handle,
        };
        await this.kv.put(`${TOKEN_PREFIX}${hash}`, JSON.stringify(subject));
        return subject;
      }
    }
    return null;
  }

  private async backfillTokenIndex(
    hash: string,
  ): Promise<CredentialSubject | null> {
    const server = await this.serverSubjectForHash(hash);
    if (server !== null) return server;
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
