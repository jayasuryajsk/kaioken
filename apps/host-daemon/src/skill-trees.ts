import type { HostDaemonSkillTree } from "@kaioken/host-daemon-contract";

export type FetchSkillTree = (treeHash: string) => Promise<HostDaemonSkillTree>;
