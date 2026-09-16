export const ENDPOINT_IDS = ["openrouter", "deepseek", "custom"] as const;

export type EndpointId = (typeof ENDPOINT_IDS)[number];

export type AuthStyle = "bearer" | "apiKey";

export const HARNESS_IDS = ["claude-code", "codex"] as const;

export type HarnessId = (typeof HARNESS_IDS)[number];

export const HARNESS_LABELS: Readonly<Record<HarnessId, string>> = {
  "claude-code": "Claude Code",
  codex: "Codex",
};

export interface EndpointDefinition {
  id: EndpointId;
  label: string;
  anthropicBaseUrl: string | null;
  responsesBaseUrl: string | null;
  authStyle: AuthStyle;
  modelsUrl: string | null;
  modelsNeedKey: boolean;
}

export const ENDPOINTS: Readonly<Record<EndpointId, EndpointDefinition>> = {
  openrouter: {
    id: "openrouter",
    label: "OpenRouter",
    anthropicBaseUrl: "https://openrouter.ai/api",
    responsesBaseUrl: "https://openrouter.ai/api/v1",
    authStyle: "bearer",
    modelsUrl: "https://openrouter.ai/api/v1/models",
    modelsNeedKey: false,
  },
  deepseek: {
    id: "deepseek",
    label: "DeepSeek",
    anthropicBaseUrl: "https://api.deepseek.com/anthropic",
    responsesBaseUrl: "https://api.deepseek.com",
    authStyle: "apiKey",
    modelsUrl: "https://api.deepseek.com/models",
    modelsNeedKey: true,
  },
  custom: {
    id: "custom",
    label: "Custom",
    anthropicBaseUrl: null,
    responsesBaseUrl: null,
    authStyle: "bearer",
    modelsUrl: null,
    modelsNeedKey: true,
  },
};

export function isEndpointId(value: string | undefined): value is EndpointId {
  return ENDPOINT_IDS.some((id) => id === value);
}

export function isHarnessId(value: string | undefined): value is HarnessId {
  return HARNESS_IDS.some((id) => id === value);
}

export interface RoutingConfig {
  openrouterKey: string;
  deepseekKey: string;
  customLabel: string;
  customBaseUrl: string;
  customResponsesBaseUrl: string;
  customKey: string;
}

export interface RoutedModel {
  endpoint: EndpointId;
  model: string;
}

export function routedModelId(endpoint: EndpointId, model: string): string {
  return `${endpoint}/${model}`;
}

export function parseRoutedModelId(id: string): RoutedModel | null {
  const separator = id.indexOf("/");
  if (separator <= 0) return null;
  const endpoint = id.slice(0, separator);
  const model = id.slice(separator + 1).trim();
  if (!isEndpointId(endpoint) || model.length === 0) return null;
  return { endpoint, model };
}

export interface ResolvedEndpoint {
  endpoint: EndpointDefinition;
  label: string;
  baseUrl: string;
  key: string;
}

export type EndpointResolution =
  | { status: "incomplete"; endpoint: EndpointDefinition; reason: string }
  | { status: "ready"; route: ResolvedEndpoint };

export function keyFor(config: RoutingConfig, endpoint: EndpointId): string {
  if (endpoint === "openrouter") return config.openrouterKey.trim();
  if (endpoint === "deepseek") return config.deepseekKey.trim();
  return config.customKey.trim();
}

export function endpointLabel(
  config: RoutingConfig,
  endpoint: EndpointId,
): string {
  if (endpoint === "custom" && config.customLabel.trim().length > 0) {
    return config.customLabel.trim();
  }
  return ENDPOINTS[endpoint].label;
}

function normalizeBaseUrl(value: string): string | null {
  const trimmed = value.trim().replace(/\/+$/u, "");
  if (trimmed.length === 0) return null;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return null;
    }
    return trimmed;
  } catch {
    return null;
  }
}

function baseUrlFor(
  config: RoutingConfig,
  endpoint: EndpointDefinition,
  harness: HarnessId,
): string {
  if (harness === "claude-code") {
    return endpoint.anthropicBaseUrl ?? config.customBaseUrl;
  }
  return endpoint.responsesBaseUrl ?? config.customResponsesBaseUrl;
}

function missingBaseUrlReason(harness: HarnessId): string {
  return harness === "claude-code"
    ? "Set a custom base URL that speaks the Anthropic Messages API, for example https://example.com/anthropic."
    : "Set a custom Responses base URL for Codex, for example https://example.com/v1.";
}

export function resolveEndpoint(
  config: RoutingConfig,
  endpointId: EndpointId,
  harness: HarnessId,
): EndpointResolution {
  const endpoint = ENDPOINTS[endpointId];
  const key = keyFor(config, endpointId);
  if (key.length === 0) {
    return {
      status: "incomplete",
      endpoint,
      reason: `Add the ${endpoint.label} API key before using it with ${HARNESS_LABELS[harness]}.`,
    };
  }
  const baseUrl = normalizeBaseUrl(baseUrlFor(config, endpoint, harness));
  if (baseUrl === null) {
    return {
      status: "incomplete",
      endpoint,
      reason: missingBaseUrlReason(harness),
    };
  }
  return {
    status: "ready",
    route: {
      endpoint,
      label: endpointLabel(config, endpointId),
      baseUrl,
      key,
    },
  };
}

export interface EnvEntry {
  name: string;
  value: string;
  reason: string;
  secret: boolean;
}

const CLAUDE_CODE_MODEL_ALIASES = [
  "ANTHROPIC_MODEL",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
  "ANTHROPIC_SMALL_FAST_MODEL",
  "CLAUDE_CODE_SUBAGENT_MODEL",
] as const;

export function claudeCodeEnv(
  config: RoutingConfig,
  modelId: string,
): EnvEntry[] {
  const routed = parseRoutedModelId(modelId);
  if (routed === null) return [];
  const resolution = resolveEndpoint(config, routed.endpoint, "claude-code");
  if (resolution.status !== "ready") return [];
  const { route } = resolution;
  const entries: EnvEntry[] = [
    {
      name: "ANTHROPIC_BASE_URL",
      value: route.baseUrl,
      reason: `Claude Code routed to ${route.label}`,
      secret: false,
    },
  ];
  if (route.endpoint.authStyle === "bearer") {
    entries.push(
      {
        name: "ANTHROPIC_AUTH_TOKEN",
        value: route.key,
        reason: `${route.label} API key`,
        secret: true,
      },
      {
        name: "ANTHROPIC_API_KEY",
        value: "",
        reason: `${route.label} authenticates with a bearer token, so the Anthropic key must be empty`,
        secret: false,
      },
    );
  } else {
    entries.push(
      {
        name: "ANTHROPIC_API_KEY",
        value: route.key,
        reason: `${route.label} API key`,
        secret: true,
      },
      {
        name: "ANTHROPIC_AUTH_TOKEN",
        value: "",
        reason: `${route.label} authenticates with an API key header, so the bearer token must be empty`,
        secret: false,
      },
    );
  }
  for (const name of CLAUDE_CODE_MODEL_ALIASES) {
    entries.push({
      name,
      value: routed.model,
      reason:
        name === "ANTHROPIC_MODEL"
          ? `Model chosen in the picker for ${route.label}`
          : `Keep every Claude Code request on the ${route.label} model, including background ones`,
      secret: false,
    });
  }
  return entries;
}

export function codexEnv(config: RoutingConfig, modelId: string): EnvEntry[] {
  const routed = parseRoutedModelId(modelId);
  if (routed === null) return [];
  const resolution = resolveEndpoint(config, routed.endpoint, "codex");
  if (resolution.status !== "ready") return [];
  const { route } = resolution;
  return [
    {
      name: "CODEX_CUSTOM_BASE_URL",
      value: route.baseUrl,
      reason: `Codex routed to ${route.label}`,
      secret: false,
    },
    {
      name: "CODEX_CUSTOM_AUTH_TOKEN",
      value: route.key,
      reason: `${route.label} API key, read by the Codex CLI through env_key`,
      secret: true,
    },
    {
      name: "CODEX_CUSTOM_NAME",
      value: route.label,
      reason: `Display name for the ${route.label} model provider`,
      secret: false,
    },
    {
      name: "CODEX_CUSTOM_MODEL",
      value: routed.model,
      reason: `Model chosen in the picker for ${route.label}`,
      secret: false,
    },
  ];
}

export function harnessEnv(
  config: RoutingConfig,
  harness: HarnessId,
  modelId: string,
): EnvEntry[] {
  return harness === "claude-code"
    ? claudeCodeEnv(config, modelId)
    : codexEnv(config, modelId);
}

export function describeEndpoint(
  config: RoutingConfig,
  endpointId: EndpointId,
): string {
  const label = endpointLabel(config, endpointId);
  const parts = HARNESS_IDS.map((harness) => {
    const resolution = resolveEndpoint(config, endpointId, harness);
    return resolution.status === "ready"
      ? `${HARNESS_LABELS[harness]} ready`
      : `${HARNESS_LABELS[harness]}: ${resolution.reason}`;
  });
  return `${label} — ${parts.join("; ")}`;
}
