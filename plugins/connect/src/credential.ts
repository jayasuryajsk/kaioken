import {
  clearPrivateState,
  readPrivateState,
  writePrivateState,
} from "./private-state.js";
import { connectCredentialSchema } from "@kaioken/connect-client";
import type { ConnectCredential } from "@kaioken/connect-client";
import type { PluginKvStorage } from "@get-kaioken/plugin-sdk";

export const CREDENTIAL_KV_KEY = "credential";

export interface CredentialStore {
  read(): Promise<ConnectCredential | null>;
  write(value: ConnectCredential): Promise<void>;
  clear(): Promise<void>;
}

export function createKvCredentialStore(
  kv: Pick<PluginKvStorage, "get" | "set" | "delete">,
): CredentialStore {
  return {
    async read() {
      const raw = await kv.get<unknown>(CREDENTIAL_KV_KEY);
      if (raw === undefined) return null;
      const parsed = connectCredentialSchema.safeParse(raw);
      return parsed.success ? parsed.data : null;
    },
    async write(value) {
      await kv.set(CREDENTIAL_KV_KEY, value);
    },
    async clear() {
      await kv.delete(CREDENTIAL_KV_KEY);
    },
  };
}

export function createAccountCredentialStore(
  kv: Pick<PluginKvStorage, "get" | "set" | "delete">,
  path: string,
): CredentialStore {
  const legacy = createKvCredentialStore(kv);
  return {
    async read() {
      return (
        (await readPrivateState(path, connectCredentialSchema)) ??
        (await legacy.read())
      );
    },
    async write(value) {
      if (value.account) {
        await writePrivateState(path, value);
        await legacy.clear();
      } else {
        await legacy.write(value);
        await clearPrivateState(path);
      }
    },
    async clear() {
      await clearPrivateState(path);
      await legacy.clear();
    },
  };
}
