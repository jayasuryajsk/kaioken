import { DEFAULTS } from "@kaioken/config/defaults";
import {
  defaultAppSettings,
  defaultAppTheme,
  defaultExperiments,
  defaultFeatureFlags,
} from "@kaioken/domain";
import type { SystemConfigResponse } from "@kaioken/server-contract";

export function makeSystemConfig(
  overrides: Partial<SystemConfigResponse> = {},
): SystemConfigResponse {
  return {
    generalSettings: defaultAppSettings,
    keybindings: [],
    defaultKeybindings: [],
    keybindingOverrides: [],
    experiments: defaultExperiments,
    appearance: defaultAppTheme,
    customThemes: [],
    pluginThemes: [],
    featureFlags: defaultFeatureFlags,
    hostDaemonPort: null,
    localHelperPorts: [],
    serverUrl: "http://localhost:38886",
    primaryHostId: null,
    primaryHostPlatform: null,
    voiceTranscriptionEnabled: false,
    aiServices: {
      inference: DEFAULTS.inferenceModel,
      inferenceFallback: DEFAULTS.inferenceFallbackModel,
      transcription: DEFAULTS.transcriptionModel,
      services: [],
    },
    dataDir: "/tmp/kaioken-test",
    ...overrides,
  };
}
