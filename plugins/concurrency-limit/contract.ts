import { defineRpcContract } from "@get-kaioken/plugin-sdk";
import { z } from "zod";

export const concurrencyLimitHostContract = defineRpcContract({
  getCapacity: {
    input: z.null(),
    output: z
      .object({
        availableParallelism: z.number().int().positive(),
      })
      .strict(),
  },
});
