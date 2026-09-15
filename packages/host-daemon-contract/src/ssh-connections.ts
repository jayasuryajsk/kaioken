import { z } from "zod";

export const sshAliasSchema = z
  .string()
  .min(1)
  .max(255)
  .regex(/^[a-zA-Z0-9_][a-zA-Z0-9_.@-]*$/u);
export const sshConnectionSchema = z.object({
  alias: sshAliasSchema,
  remotePort: z.number().int().min(1).max(65535),
  url: z.string().url().nullable(),
  state: z.enum(["connecting", "ready", "reconnecting", "offline", "error"]),
  error: z.string().nullable(),
});
export type SshConnection = z.infer<typeof sshConnectionSchema>;
export const sshConnectionListSchema = z.object({
  aliases: z.array(sshAliasSchema),
  connections: z.array(sshConnectionSchema),
});
export type SshConnectionList = z.infer<typeof sshConnectionListSchema>;

export const sshHttpRequestSchema = z
  .object({
    alias: sshAliasSchema,
    path: z
      .string()
      .min(1)
      .refine((path) => {
        try {
          const url = new URL(path, "http://ssh.invalid");
          return (
            path.startsWith("/api/v1/") &&
            url.origin === "http://ssh.invalid" &&
            url.pathname.startsWith("/api/v1/") &&
            !path.includes("\\")
          );
        } catch {
          return false;
        }
      }, "SSH requests must target a Kaioken API path"),
    method: z.enum([
      "GET",
      "HEAD",
      "POST",
      "PUT",
      "PATCH",
      "DELETE",
      "OPTIONS",
    ]),
    headers: z.record(z.string(), z.string()),
    body: z
      .string()
      .max(44_739_244)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u,
      )
      .nullable(),
  })
  .strict();
export type SshHttpRequest = z.infer<typeof sshHttpRequestSchema>;
export const sshHttpResponseSchema = z.object({
  status: z.number().int().min(200).max(599),
  headers: z.record(z.string(), z.string()),
  body: z.string().max(44_739_244),
});
export type SshHttpResponse = z.infer<typeof sshHttpResponseSchema>;

export const sshConnectionCommandSchemas = {
  "host.ssh.list": z.object({ type: z.literal("host.ssh.list") }).strict(),
  "host.ssh.connect": z
    .object({
      type: z.literal("host.ssh.connect"),
      alias: sshAliasSchema,
      remotePort: z.number().int().min(1).max(65535),
      startupCommand: z.string().min(1),
    })
    .strict(),
  "host.ssh.disconnect": z
    .object({ type: z.literal("host.ssh.disconnect"), alias: sshAliasSchema })
    .strict(),
  "host.ssh.request": sshHttpRequestSchema.extend({
    type: z.literal("host.ssh.request"),
  }),
};
