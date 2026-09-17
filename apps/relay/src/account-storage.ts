import type { RelayStorage } from "./store.js";

interface StoredValue {
  value: string;
  expiresAt: number | null;
}

export class AccountStorage implements RelayStorage {
  constructor(
    private readonly storage: Pick<
      DurableObjectStorage,
      "get" | "put" | "delete" | "list" | "getAlarm" | "setAlarm"
    >,
  ) {}

  get<T>(key: string, type: "json"): Promise<T | null>;
  get(key: string): Promise<string | null>;
  async get<T>(key: string, type?: "json"): Promise<T | string | null> {
    const entry = await this.storage.get<StoredValue>(`data:${key}`);
    if (!entry || (entry.expiresAt !== null && entry.expiresAt <= Date.now())) {
      return null;
    }
    return type === "json" ? JSON.parse(entry.value) : entry.value;
  }

  async put(
    key: string,
    value: string,
    options?: { expirationTtl: number },
  ): Promise<void> {
    const expiresAt = options
      ? Date.now() + options.expirationTtl * 1000
      : null;
    await this.storage.put(`data:${key}`, { value, expiresAt });
    if (expiresAt !== null) {
      const alarm = await this.storage.getAlarm();
      if (alarm === null || alarm > expiresAt)
        await this.storage.setAlarm(expiresAt);
    }
  }

  async delete(key: string): Promise<void> {
    await this.storage.delete(`data:${key}`);
  }

  async list({
    prefix,
  }: {
    prefix: string;
  }): Promise<{ keys: { name: string }[] }> {
    const entries = await this.storage.list<StoredValue>({
      prefix: `data:${prefix}`,
    });
    return {
      keys: [...entries]
        .filter(
          ([, entry]) =>
            entry.expiresAt === null || entry.expiresAt > Date.now(),
        )
        .map(([key]) => ({ name: key.slice(5) })),
    };
  }

  async expireEphemeralRecords(): Promise<void> {
    let next: number | null = null;
    for (const prefix of ["data:code:", "data:registration:"]) {
      const records = await this.storage.list<StoredValue>({ prefix });
      for (const [key, entry] of records) {
        if (entry.expiresAt === null || entry.expiresAt <= Date.now())
          await this.storage.delete(key);
        else next = Math.min(next ?? entry.expiresAt, entry.expiresAt);
      }
    }
    if (next !== null) await this.storage.setAlarm(next);
  }
}
