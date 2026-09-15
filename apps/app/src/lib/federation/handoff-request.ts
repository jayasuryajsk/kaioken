import { z } from "zod";
export const HANDOFF_REQUEST_EVENT = "kaioken:request-connection-handoff";
export const handoffRequestSchema = z.object({
  threadId: z.string().min(1),
  handle: z.string().min(1).nullable(),
});
export type HandoffRequest = z.infer<typeof handoffRequestSchema>;
export function requestConnectionHandoff(request: HandoffRequest): void {
  window.dispatchEvent(
    new CustomEvent(HANDOFF_REQUEST_EVENT, { detail: request }),
  );
}
