import type {
  ServerAccessStatus,
  SystemMachineProvider,
} from "@bb/server-contract";
import type { MachineAccessState } from "../src/components/settings/MachineAccessSettings";
import modalLogoUrl from "../../../plugins/environment-modal-sandbox/modal-logo.svg";

const noop = () => {};
const noopAsync = async () => {};

export const CONNECT_UNPAIRED: ServerAccessStatus = {
  providers: [
    {
      id: "connect",
      displayName: "bb connect",
      attention: null,
      availability: {
        status: "setup-required",
        message: "Pair this bb instance with bb connect",
      },
    },
    {
      id: "direct",
      displayName: "Manual",
      attention: null,
      availability: { status: "available" },
    },
  ],
  defaultProviderId: "connect",
  effectiveUrl: null,
  urlSource: null,
};

function withConnect(
  availability: ServerAccessStatus["providers"][number]["availability"],
  attention: string | null = null,
): ServerAccessStatus {
  return {
    ...CONNECT_UNPAIRED,
    providers: [
      { id: "connect", displayName: "bb connect", attention, availability },
      CONNECT_UNPAIRED.providers[1]!,
    ],
  };
}

export const CONNECT_PAIRED = withConnect({
  status: "available",
  serverUrl: "https://sawyer.getbb.app",
});

export const CONNECT_PAIRED_WITHOUT_URL = withConnect({ status: "available" });

export const CONNECT_UNAVAILABLE = withConnect({
  status: "unavailable",
  message: "The gate rejected this bb's credential (HTTP 401)",
});

export const CONNECT_NEEDS_ATTENTION = withConnect(
  { status: "available", serverUrl: "https://sawyer.getbb.app" },
  "2 legacy access records need attention",
);

export const MANUAL_WITHOUT_URL: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  defaultProviderId: "direct",
};

export const MANUAL_WITH_URL: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  defaultProviderId: "direct",
  effectiveUrl: "https://bb.example.com",
  urlSource: "setting",
};

export const METHOD_NOT_INSTALLED: ServerAccessStatus = {
  ...CONNECT_UNPAIRED,
  providers: [CONNECT_UNPAIRED.providers[1]!],
  defaultProviderId: "tailscale",
};

export function machineAccessState(
  access: ServerAccessStatus,
  overrides: Partial<MachineAccessState> = {},
): MachineAccessState {
  const selected = overrides.selected ?? access.defaultProviderId ?? "connect";
  return {
    access,
    disabled: false,
    draft: null,
    error: null,
    effective: access.providers.find((provider) => provider.id === selected),
    saving: false,
    selected,
    value: access.urlSource === "setting" ? (access.effectiveUrl ?? "") : "",
    editDraft: noop,
    selectProvider: noop,
    commitUrl: noopAsync,
    ...overrides,
  };
}

export function machineProvider(
  overrides: Partial<SystemMachineProvider> &
    Pick<SystemMachineProvider, "id" | "displayName">,
): SystemMachineProvider {
  return {
    description: null,
    icon: null,
    machineTag: null,
    logoUrl: null,
    pluginId: `plugin-${overrides.id}`,
    inputs: null,
    acceptsEmptyInputs: true,
    supportsSuspend: false,
    availability: { status: "available" },
    ...overrides,
  };
}

export const MODAL_MACHINE_PROVIDER = machineProvider({
  id: "modal-sandbox",
  displayName: "Modal Sandbox",
  description:
    "Create a sandbox in your Modal account, billed by Modal while it runs and suspended when idle.",
  pluginId: "environment-modal-sandbox",
  icon: "./modal-logo.svg",
  machineTag: "modal",
  logoUrl: modalLogoUrl,
  supportsSuspend: true,
});

export const MANUAL_MACHINE_PROVIDER = machineProvider({
  id: "manual",
  displayName: "Manual machine setup",
  description:
    "Run one command on a machine you already have to connect it to this server.",
  pluginId: "machine-manual",
  icon: "Terminal",
});

export const MODAL_NEEDS_TOKEN_PROVIDER = machineProvider({
  ...MODAL_MACHINE_PROVIDER,
  availability: {
    status: "setup-required",
    message:
      "Set tokenId and tokenSecret in the plugin's settings.",
  },
});

export const MODAL_UNRENDERABLE_INPUTS_PROVIDER = machineProvider({
  ...MODAL_MACHINE_PROVIDER,
  inputs: {
    type: "object",
    properties: { region: { type: "string" } },
    required: ["region"],
  },
  acceptsEmptyInputs: false,
});

export const UNAVAILABLE_MACHINE_PROVIDER = machineProvider({
  id: "fleet",
  displayName: "Fleet",
  description: "Rent a machine from a managed fleet.",
  icon: "Server",
  availability: {
    status: "unavailable",
    message: "The region this provider was configured for is offline.",
  },
});
