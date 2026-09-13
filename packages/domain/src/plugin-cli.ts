export const RESERVED_KAIOKEN_CLI_COMMANDS: readonly string[] = [
  "browser",
  "codex",
  "environment",
  "file",
  "guide",
  "help",
  "labels",
  "machine",
  "manager",
  "marketplace",
  "plugin",
  "project",
  "provider",
  "settings",
  "skill",
  "status",
  "terminal",
  "theme",
  "thread",
  "updates",
  "voice",
];

export function pluginCliCall(pluginId: string, name: string): string {
  if (RESERVED_KAIOKEN_CLI_COMMANDS.includes(name))
    return `kaioken plugin run ${pluginId}`;
  return `kaioken ${name}`;
}
