import { z } from "zod";

export const threadHandoffStateValues = ["handed-off"] as const;
export const threadHandoffStateSchema = z.enum(threadHandoffStateValues);
export type ThreadHandoffState = z.infer<typeof threadHandoffStateSchema>;
