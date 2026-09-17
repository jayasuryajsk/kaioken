import { z } from "zod";

export const connectAccountSchema = z.object({
  githubId: z.string().regex(/^\d+$/u),
  login: z.string().min(1),
});
export type ConnectAccount = z.infer<typeof connectAccountSchema>;

export const connectLoginStartSchema = z.object({
  id: z.string().regex(/^[A-Za-z0-9_-]{32}$/u),
  browserUrl: z.string().url(),
  expiresAt: z.number(),
});
export type ConnectLoginStart = z.infer<typeof connectLoginStartSchema>;

export const connectLoginDeviceSchema = z.object({
  handle: z.string().min(1),
  name: z.string().min(1),
  serverUrl: z.string().url(),
  account: connectAccountSchema,
});
export type ConnectLoginDevice = z.infer<typeof connectLoginDeviceSchema>;

export const connectLoginStatusSchema = z.object({
  state: z.enum(["idle", "waiting", "signed-in", "error"]),
  browserUrl: z.string().url().nullable(),
  expiresAt: z.number().nullable(),
  error: z.string().nullable(),
  account: connectAccountSchema.nullable(),
});
export type ConnectLoginStatus = z.infer<typeof connectLoginStatusSchema>;
export const CONNECT_LOGIN_CHANNEL = "account-login";

export async function connectLoginRequest<T>(
  baseUrl: string,
  path: string,
  schema: z.ZodType<T>,
  body: unknown,
  proof?: string,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<T> {
  const response = await fetchImpl(new URL(path, baseUrl), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(proof ? { "x-kaioken-login-proof": proof } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  }).catch(() => {
    throw new Error(
      "Could not reach the Kaioken sign-in service. Check your connection and try again.",
    );
  });
  if (!response.ok) {
    if (response.status === 404)
      throw new Error(
        "This relay does not support GitHub sign-in yet. Update the relay or choose a configured relay in Connect settings.",
      );
    const error = z
      .object({ error: z.string() })
      .safeParse(await response.json().catch(() => null));
    throw new Error(
      error.success
        ? error.data.error
        : `Sign-in request failed (${response.status})`,
    );
  }
  return schema.parse(await response.json());
}
