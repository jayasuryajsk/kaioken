import { defineRpcContract } from "@get-bb/plugin-sdk";
import { z } from "zod";

export const commandOutput = z.object({
  command: z.string().nullable(),
  expiresAt: z.number().nullable(),
});
export const manualRpcContract = defineRpcContract({
  command: {
    input: z.object({ launchId: z.string().min(1) }).strict(),
    output: commandOutput,
  },
});
