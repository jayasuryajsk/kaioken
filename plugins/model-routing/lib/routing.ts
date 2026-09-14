export const ROUTE_IDS = [
  "default",
  "openrouter",
  "deepseek",
  "custom",
] as const;

export type RouteId = (typeof ROUTE_IDS)[number];

export type EndpointId = Exclude<RouteId, "default">;

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

export const ROUTE_OPTION_LABELS: Readonly<Record<RouteId, string>> = {
  default: "Default — this harness signs in on its own",
  openrouter: "OpenRouter",
  deepseek: "DeepSeek",
  custom: "Custom endpoint",
};

export function routeIdFromLabel(label: string): RouteId {
  const match = ROUTE_IDS.find((id) => ROUTE_OPTION_LABELS[id] === label);
  return match ?? "default";
}

export interface HarnessRouting {
  route: RouteId;
  model: string;
}

export interface RoutingConfig {
  harnesses: Readonly<Record<HarnessId, HarnessRouting>>;
  openrouterKey: string;
  deepseekKey: string;
  customLabel: string;
  customBaseUrl: string;
  customResponsesBaseUrl: string;
  customKey: string;
}

export interface ResolvedRoute {
  endpoint: EndpointDefinition;
  label: string;
  baseUrl: string;
  key: string;
  model: string;
}

export type RouteResolution =
  | { status: "default" }
  | { status: "incomplete"; endpoint: EndpointDefinition; reason: string }
  | { status: "ready"; route: ResolvedRoute };

function keyFor(config: RoutingConfig, endpoint: EndpointId): string {
  if (endpoint === "openrouter") return config.openrouterKey.trim();
  if (endpoint === "deepseek") return config.deepseekKey.trim();
  return config.customKey.trim();
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

export function resolveRoute(
  config: RoutingConfig,
  harness: HarnessId,
): RouteResolution {
  const selection = config.harnesses[harness];
  if (selection.route === "default") return { status: "default" };
  const endpoint = ENDPOINTS[selection.route];
  const key = keyFor(config, endpoint.id);
  if (key.length === 0) {
    return {
      status: "incomplete",
      endpoint,
      reason: `Add the ${endpoint.label} API key before routing ${HARNESS_LABELS[harness]}.`,
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
  const label =
    endpoint.id === "custom" && config.customLabel.trim().length > 0
      ? config.customLabel.trim()
      : endpoint.label;
  return {
    status: "ready",
    route: { endpoint, label, baseUrl, key, model: selection.model.trim() },
  };
}

export interface EnvEntry {
  name: string;
  value: string;
  reason: string;
  secret: boolean;
}

export function claudeCodeEnv(config: RoutingConfig): EnvEntry[] {
  const resolution = resolveRoute(config, "claude-code");
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
  if (route.model.length > 0) {
    entries.push({
      name: "ANTHROPIC_MODEL",
      value: route.model,
      reason: `Model chosen for ${route.label}`,
      secret: false,
    });
  }
  return entries;
}

export function codexEnv(config: RoutingConfig): EnvEntry[] {
  const resolution = resolveRoute(config, "codex");
  if (resolution.status !== "ready") return [];
  const { route } = resolution;
  const entries: EnvEntry[] = [
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
  ];
  if (route.model.length > 0) {
    entries.push({
      name: "CODEX_CUSTOM_MODEL",
      value: route.model,
      reason: `Model chosen for ${route.label}`,
      secret: false,
    });
  }
  return entries;
}

export function harnessEnv(
  config: RoutingConfig,
  harness: HarnessId,
): EnvEntry[] {
  return harness === "claude-code" ? claudeCodeEnv(config) : codexEnv(config);
}

export function describeRoute(
  config: RoutingConfig,
  harness: HarnessId,
): string {
  const resolution = resolveRoute(config, harness);
  if (resolution.status === "default") {
    return "Default — this harness signs in on its own.";
  }
  if (resolution.status === "incomplete") return resolution.reason;
  const { route } = resolution;
  const model = route.model.length > 0 ? route.model : "the endpoint default";
  return `Routed to ${route.label} at ${route.baseUrl}, using ${model}.`;
}
