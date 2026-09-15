import { z } from "zod";

export const KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_BODY_BYTES = 32 * 1024 * 1024;
export const KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_REQUEST_BODY_BYTES =
  32 * 1024 * 1024;

export const kaiokenDesktopFederatedFetchMethods = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
] as const;
export type KaiokenDesktopFederatedFetchMethod =
  (typeof kaiokenDesktopFederatedFetchMethods)[number];

export const kaiokenDesktopFederatedFetchRequestSchema = z
  .object({
    url: z.string().url(),
    method: z.enum(kaiokenDesktopFederatedFetchMethods).default("GET"),
    headers: z.record(z.string(), z.string()).default({}),
    body: z
      .string()
      .max(
        Math.ceil(
          (KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_REQUEST_BODY_BYTES * 4) / 3,
        ) + 4,
      )
      .optional(),
    bodyEncoding: z.enum(["utf8", "base64"]).optional(),
    responseEncoding: z.enum(["utf8", "base64"]).optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.body === undefined ||
      (request.method !== "GET" && request.method !== "HEAD"),
    { message: "GET and HEAD requests cannot carry a body" },
  )
  .refine(
    (request) =>
      request.bodyEncoding !== "base64" ||
      (request.body !== undefined &&
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
          request.body,
        )),
    { message: "The request body must contain valid base64" },
  );
export type KaiokenDesktopFederatedFetchRequest = z.input<
  typeof kaiokenDesktopFederatedFetchRequestSchema
>;

export const kaiokenDesktopFederatedFetchResponseSchema = z
  .object({
    status: z.number().int(),
    headers: z.array(z.tuple([z.string(), z.string()])),
    body: z.string(),
    bodyEncoding: z.enum(["utf8", "base64"]).optional(),
  })
  .strict();
export type KaiokenDesktopFederatedFetchResponse = z.infer<
  typeof kaiokenDesktopFederatedFetchResponseSchema
>;

export const federatedSocketRequestSchema = z
  .object({
    id: z.string().uuid(),
    url: z.string().url(),
  })
  .strict();

export const federatedSocketSendSchema = z
  .object({
    id: z.string().uuid(),
    data: z
      .string()
      .max(KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_REQUEST_BODY_BYTES),
  })
  .strict();

export const federatedSocketCloseSchema = z
  .object({ id: z.string().uuid() })
  .strict();

export const federatedSocketEventSchema = z.discriminatedUnion("type", [
  z.object({ id: z.string().uuid(), type: z.literal("open") }),
  z.object({
    id: z.string().uuid(),
    type: z.literal("message"),
    data: z.string(),
  }),
  z.object({ id: z.string().uuid(), type: z.literal("error") }),
  z.object({ id: z.string().uuid(), type: z.literal("close") }),
]);

export type FederatedSocketEvent = z.infer<typeof federatedSocketEventSchema>;

export interface KaiokenDesktopFederatedSocketApi {
  open(request: z.infer<typeof federatedSocketRequestSchema>): Promise<void>;
  send(request: z.infer<typeof federatedSocketSendSchema>): void;
  close(request: z.infer<typeof federatedSocketCloseSchema>): void;
  subscribe(listener: (event: FederatedSocketEvent) => void): () => void;
}
