import { z } from "zod";

export const KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_BODY_BYTES = 8 * 1024 * 1024;
export const KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_REQUEST_BODY_BYTES =
  1024 * 1024;

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
    body: z.string().optional(),
  })
  .strict()
  .refine(
    (request) =>
      request.body === undefined ||
      (request.method !== "GET" && request.method !== "HEAD"),
    { message: "GET and HEAD requests cannot carry a body" },
  );
export type KaiokenDesktopFederatedFetchRequest = z.input<
  typeof kaiokenDesktopFederatedFetchRequestSchema
>;

export const kaiokenDesktopFederatedFetchResponseSchema = z
  .object({
    status: z.number().int(),
    headers: z.array(z.tuple([z.string(), z.string()])),
    body: z.string(),
  })
  .strict();
export type KaiokenDesktopFederatedFetchResponse = z.infer<
  typeof kaiokenDesktopFederatedFetchResponseSchema
>;
