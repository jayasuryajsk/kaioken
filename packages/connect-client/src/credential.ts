import { z } from "zod";
import { connectAccountSchema } from "./login.js";

export const connectCredentialSchema = z.object({
  serverUrl: z.string().min(1),
  handle: z.string().min(1),
  credential: z.string().min(1),
  account: connectAccountSchema.optional(),
});

export type ConnectCredential = z.infer<typeof connectCredentialSchema>;
