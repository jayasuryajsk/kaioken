import type {
  EditableSkillScope,
  SkillScope,
  SkillSummary,
} from "@kaioken/server-contract";

const SKILL_ROOT_LABELS: Record<
  Exclude<SkillScope, "provider-user" | "provider-project">,
  string
> = {
  "kaioken-builtin": "Built-in",
  "kaioken-user": "kaioken · user",
  "kaioken-project": "kaioken · project",
  "shared-user": "Shared · user",
  "shared-project": "Shared · project",
  plugin: "Plugin",
};

export function skillScopeLabel(
  skill: Pick<SkillSummary, "scope" | "provider">,
  providerDisplayName?: string,
): string {
  if (skill.scope === "provider-user" || skill.scope === "provider-project") {
    const root = skill.scope === "provider-user" ? "user" : "project";
    const provider = skill.provider;
    const providerLabel =
      providerDisplayName ?? (provider === null ? "Provider" : provider);
    return `${providerLabel} · ${root}`;
  }
  return SKILL_ROOT_LABELS[skill.scope];
}

export function isSkillEditable(
  skill: SkillSummary,
): skill is SkillSummary & { scope: EditableSkillScope } {
  switch (skill.scope) {
    case "kaioken-user":
    case "kaioken-project":
      return true;
    case "provider-user":
    case "provider-project":
      return skill.manageable;
    case "shared-user":
    case "shared-project":
    case "kaioken-builtin":
    case "plugin":
      return false;
  }
}
