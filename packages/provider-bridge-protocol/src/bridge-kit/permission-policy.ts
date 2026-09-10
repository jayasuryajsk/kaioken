import type { PermissionEscalation } from "@kaioken/domain";

export interface InteractiveRequestPolicyInput {
  permissionEscalation: PermissionEscalation | null;
}

export function shouldAutoDenyInteractiveRequest(
  policy: InteractiveRequestPolicyInput,
): boolean {
  return policy.permissionEscalation === "deny";
}
