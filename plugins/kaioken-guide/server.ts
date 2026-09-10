import type { KaiokenPluginApi } from "@get-kaioken/plugin-sdk";
import { renderTemplate } from "@kaioken/templates";

export default async function plugin(bb: KaiokenPluginApi) {
  const settings = bb.settings.define({
    introduction: {
      type: "boolean",
      label: "Send Kaioken introduction",
      description:
        "Tell agents about the Kaioken CLI, threads, and clickable links. Applies to new agent sessions.",
      default: true,
    },
    skills: {
      type: "boolean",
      label: "Enable bundled skills",
      description: "Make the selected Kaioken guide skills available to agents.",
      default: true,
    },
    kaiokenCli: {
      type: "boolean",
      label: "Kaioken CLI skill",
      description: "Inspect and manage Kaioken through the CLI.",
      default: true,
    },
    pluginAuthoring: {
      type: "boolean",
      label: "Plugin authoring skill",
      description: "Create and change Kaioken plugins and SDK extensions.",
      default: true,
    },
    skillCreator: {
      type: "boolean",
      label: "Skill creator skill",
      description: "Create and improve Kaioken skills.",
      default: true,
    },
    submitPlugin: {
      type: "boolean",
      label: "Plugin submission skill",
      description:
        "Prepare and submit a Kaioken plugin to the Community marketplace.",
      default: true,
    },
  });
  let current = await settings.get();
  settings.onChange((next) => {
    current = next;
  });
  bb.agents.contributeInstructions(() =>
    current.introduction
      ? renderTemplate("standardAgentAppendInstructions", {})
      : null,
  );
  bb.agents.configure(() => ({
    tools: [],
    skills: current.skills
      ? [
          ...(current.kaiokenCli ? ["kaioken-cli"] : []),
          ...(current.pluginAuthoring ? ["kaioken-plugin-authoring"] : []),
          ...(current.skillCreator ? ["skill-creator"] : []),
          ...(current.submitPlugin ? ["submit-a-plugin"] : []),
        ]
      : [],
  }));
}
