function quoteResourceName(name: string): string {
  return JSON.stringify(name);
}

export function buildPluginEditThreadPrompt({
  name,
  path,
}: {
  name: string;
  path: string;
}): string {
  return `Edit the kaioken plugin ${quoteResourceName(name)} at ${path}. I want to `;
}

export function buildSkillEditThreadPrompt({
  id,
  name,
  path,
}: {
  id: string;
  name: string;
  path: string;
}): string {
  return `Edit the kaioken skill ${quoteResourceName(name)} (ID ${id}) at ${path}. Inspect it with kaioken skill show ${id} --json and pass that revision to kaioken skill update when saving. I want to `;
}

export function buildAutomationEditThreadPrompt({
  name,
  projectId,
  automationId,
}: {
  name: string;
  projectId: string;
  automationId: string;
}): string {
  return `Edit the kaioken automation ${quoteResourceName(name)} (ID ${automationId}) in project ${projectId}. I want to `;
}
