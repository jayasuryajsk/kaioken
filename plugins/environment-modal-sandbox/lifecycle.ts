import { z } from "zod";

export const modalMachineResourceSchema = z.object({
  key: z.string().min(1),
  sandboxId: z.string().min(1).nullable(),
  snapshotImageId: z.string().min(1).nullable(),
  pendingSnapshotImageIds: z.array(z.string().min(1)),
  version: z.literal(5),
  imageId: z.string().min(1).nullable(),
  accountIdentity: z.string().min(1).nullable(),
  appName: z.string().min(1).nullable(),
  cpu: z.number().positive().nullable(),
  memoryMiB: z.number().positive().nullable(),
  snapshotSandboxId: z.string().min(1).nullable().default(null),
});
export type ModalMachineResource = z.infer<typeof modalMachineResourceSchema>;
export function readModalMachineResource(value: unknown): ModalMachineResource {
  return modalMachineResourceSchema.parse(value);
}
