import { z } from "zod";

export const KAIOKEN_DESKTOP_FEDERATED_FETCH_MAX_BODY_BYTES = 8 * 1024 * 1024;

export const kaiokenDesktopFederatedFetchRequestSchema = z
  .object({
    url: z.string().url(),
    method: z.enum(["GET", "HEAD"]).default("GET"),
    headers: z.record(z.string(), z.string()).default({}),
  })
  .strict();
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
