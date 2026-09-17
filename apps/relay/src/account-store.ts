import { z } from "zod";
import type { Env } from "./tunnel-do.js";

const serverSchema = z.object({
  credentialHash: z.string(),
  handle: z.string(),
  name: z.string(),
  pairedAt: z.number(),
});
const machineSchema = z.object({
  credentialHash: z.string(),
  label: z.string(),
  createdAt: z.number(),
});
const subjectSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("server"), handle: z.string() }),
  z.object({ kind: z.literal("machine"), machineId: z.string() }),
]);

export const accountCommandSchema = z.discriminatedUnion("method", [
  z.object({
    method: z.literal("cancelRegistration"),
    args: z.tuple([z.string().regex(/^[a-f0-9]{64}$/u)]),
  }),
  z.object({
    method: z.literal("registerDevice"),
    args: z.tuple([
      z.string().min(1).max(80),
      z.string().regex(/^[a-f0-9]{64}$/u),
      z
        .object({
          handle: z.string(),
          hash: z.string().regex(/^[a-f0-9]{64}$/u),
        })
        .nullable(),
    ]),
  }),
  z.object({ method: z.literal("getServer"), args: z.tuple([z.string()]) }),
  z.object({ method: z.literal("listServers"), args: z.tuple([]) }),
  z.object({
    method: z.literal("pairServer"),
    args: z.tuple([z.string(), z.string(), z.string()]),
  }),
  z.object({ method: z.literal("unpairServer"), args: z.tuple([z.string()]) }),
  z.object({
    method: z.literal("createMachineCode"),
    args: z.tuple([z.string()]),
  }),
  z.object({
    method: z.literal("consumeMachineCode"),
    args: z.tuple([z.string()]),
  }),
  z.object({
    method: z.literal("addMachine"),
    args: z.tuple([z.string(), z.string(), z.string()]),
  }),
  z.object({ method: z.literal("removeMachine"), args: z.tuple([z.string()]) }),
  z.object({ method: z.literal("machineExists"), args: z.tuple([z.string()]) }),
  z.object({
    method: z.literal("resolveCredential"),
    args: z.tuple([z.string()]),
  }),
]);

export function accountStub(env: Env): DurableObjectStub {
  return env.ACCOUNT_DO.get(env.ACCOUNT_DO.idFromName("personal"));
}

export class AccountStore {
  constructor(private readonly env: Env) {}

  private async call<T>(
    command: z.infer<typeof accountCommandSchema>,
    schema: z.ZodType<T>,
  ): Promise<T> {
    const response = await accountStub(this.env).fetch(
      "https://account/command",
      { method: "POST", body: JSON.stringify(command) },
    );
    if (!response.ok)
      throw new Error(`Account command failed (${response.status})`);
    return schema.parse(await response.json());
  }

  getServer(handle: string) {
    return this.call(
      { method: "getServer", args: [handle] },
      serverSchema.nullable(),
    );
  }
  listServers() {
    return this.call(
      { method: "listServers", args: [] },
      z.array(serverSchema),
    );
  }
  pairServer(handle: string, name: string, credential: string) {
    return this.call(
      { method: "pairServer", args: [handle, name, credential] },
      serverSchema,
    );
  }
  registerDevice(
    name: string,
    hash: string,
    previous: { handle: string; hash: string } | null,
  ) {
    return this.call(
      { method: "registerDevice", args: [name, hash, previous] },
      serverSchema.nullable(),
    );
  }
  cancelRegistration(hash: string) {
    return this.call(
      { method: "cancelRegistration", args: [hash] },
      z.string().nullable(),
    );
  }
  unpairServer(handle: string) {
    return this.call({ method: "unpairServer", args: [handle] }, z.boolean());
  }
  createMachineCode(code: string) {
    return this.call({ method: "createMachineCode", args: [code] }, z.null());
  }
  consumeMachineCode(code: string) {
    return this.call(
      { method: "consumeMachineCode", args: [code] },
      z.boolean(),
    );
  }
  addMachine(id: string, credential: string, label: string) {
    return this.call(
      { method: "addMachine", args: [id, credential, label] },
      machineSchema,
    );
  }
  removeMachine(id: string) {
    return this.call({ method: "removeMachine", args: [id] }, z.boolean());
  }
  machineExists(id: string) {
    return this.call({ method: "machineExists", args: [id] }, z.boolean());
  }
  resolveCredential(credential: string) {
    return this.call(
      { method: "resolveCredential", args: [credential] },
      subjectSchema.nullable(),
    );
  }
}
