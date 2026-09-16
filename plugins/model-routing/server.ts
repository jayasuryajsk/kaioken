import {
  defineRpcContract,
  type KaiokenPluginApi,
} from "@get-kaioken/plugin-sdk";
import { z } from "zod";
import {
  fetchCatalog,
  isStale,
  type CatalogModel,
  type CatalogSnapshot,
} from "./lib/catalog";
import {
  describeEndpoint,
  ENDPOINT_IDS,
  ENDPOINTS,
  endpointLabel,
  HARNESS_IDS,
  HARNESS_LABELS,
  harnessEnv,
  isEndpointId,
  keyFor,
  resolveEndpoint,
  routedModelId,
  type EndpointId,
  type HarnessId,
  type RoutingConfig,
} from "./lib/routing";

const CATALOG_PREFIX = "catalog:";
const PICKER_PREFIX = "picker:";

const pickerModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  contextLength: z.number().nullable(),
  enabled: z.boolean(),
});

const endpointStatusSchema = z.object({
  id: z.enum(ENDPOINT_IDS),
  label: z.string(),
  configured: z.boolean(),
  hasCatalog: z.boolean(),
  ready: z.object({ claudeCode: z.boolean(), codex: z.boolean() }),
  summary: z.string(),
  enabled: z.array(z.string()),
});

export const rpcContract = defineRpcContract({
  status: {
    input: z.object({}).strict(),
    output: z.object({ endpoints: z.array(endpointStatusSchema) }),
  },
  models: {
    input: z
      .object({ endpoint: z.enum(ENDPOINT_IDS), refresh: z.boolean() })
      .strict(),
    output: z.union([
      z.object({
        ok: z.literal(true),
        models: z.array(pickerModelSchema),
        fetchedAt: z.number(),
      }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  },
  setEnabled: {
    input: z
      .object({
        endpoint: z.enum(ENDPOINT_IDS),
        model: z.string().min(1),
        enabled: z.boolean(),
      })
      .strict(),
    output: z.object({ enabled: z.array(z.string()) }),
  },
});

function splitModelIds(value: string): string[] {
  const seen = new Set<string>();
  const ids: string[] = [];
  for (const part of value.split(/[\n,]/u)) {
    const id = part.trim();
    if (id.length === 0 || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

export default function plugin(bb: KaiokenPluginApi) {
  const settings = bb.settings.define({
    openrouterKey: {
      type: "string",
      label: "OpenRouter API key",
      description: "Used as the bearer token for https://openrouter.ai/api.",
      secret: true,
    },
    deepseekKey: {
      type: "string",
      label: "DeepSeek API key",
      description:
        "Used as the Anthropic API key for https://api.deepseek.com/anthropic.",
      secret: true,
    },
    customLabel: {
      type: "string",
      label: "Custom endpoint name",
      description: "Shown beside custom models in the picker.",
      default: "",
    },
    customBaseUrl: {
      type: "string",
      label: "Custom base URL (Claude Code)",
      description:
        "Must speak the Anthropic Messages API. Claude Code cannot talk to an OpenAI-shaped endpoint directly.",
      default: "",
    },
    customResponsesBaseUrl: {
      type: "string",
      label: "Custom base URL (Codex)",
      description:
        "Must speak the OpenAI Responses API, which is the only wire format the Codex CLI supports.",
      default: "",
    },
    customKey: {
      type: "string",
      label: "Custom API key",
      description: "Sent as a bearer token to the custom base URL.",
      secret: true,
    },
    customModels: {
      type: "string",
      label: "Custom endpoint models",
      description:
        "Model ids the custom endpoint serves, comma separated. Each one appears in the picker.",
      default: "",
    },
    keepCodexMcpServers: {
      type: "boolean",
      label: "Keep Codex MCP servers on routed threads",
      description:
        "Off by default: MCP servers from ~/.codex/config.toml are disabled for Codex threads on an endpoint model, because many endpoints reject tool names longer than 64 characters. Turn on if your endpoint accepts them.",
      default: false,
    },
  });

  async function config(): Promise<RoutingConfig> {
    const values = await settings.get();
    return {
      openrouterKey: values.openrouterKey ?? "",
      deepseekKey: values.deepseekKey ?? "",
      customLabel: values.customLabel ?? "",
      customBaseUrl: values.customBaseUrl ?? "",
      customResponsesBaseUrl: values.customResponsesBaseUrl ?? "",
      customKey: values.customKey ?? "",
      keepCodexMcpServers: values.keepCodexMcpServers === true,
    };
  }

  async function enabledModels(endpoint: EndpointId): Promise<string[]> {
    if (endpoint === "custom") {
      return splitModelIds((await settings.get()).customModels ?? "");
    }
    const stored = await bb.storage.kv.get<string[]>(
      `${PICKER_PREFIX}${endpoint}`,
    );
    return Array.isArray(stored)
      ? stored.filter((id): id is string => typeof id === "string")
      : [];
  }

  async function setEnabledModels(
    endpoint: EndpointId,
    ids: string[],
  ): Promise<void> {
    await bb.storage.kv.set(`${PICKER_PREFIX}${endpoint}`, ids);
  }

  async function cachedCatalog(
    endpoint: EndpointId,
  ): Promise<CatalogSnapshot | undefined> {
    return bb.storage.kv.get<CatalogSnapshot>(`${CATALOG_PREFIX}${endpoint}`);
  }

  async function catalogFor(
    endpoint: EndpointId,
    refresh: boolean,
  ): Promise<CatalogSnapshot> {
    const cached = await cachedCatalog(endpoint);
    const now = Date.now();
    if (cached !== undefined && !refresh && !isStale(cached, now)) {
      return cached;
    }
    const snapshot = await fetchCatalog({
      endpoint,
      key: keyFor(await config(), endpoint),
      fetchImpl: fetch,
      now,
    });
    await bb.storage.kv.set(`${CATALOG_PREFIX}${endpoint}`, snapshot);
    return snapshot;
  }

  function catalogLookup(
    snapshot: CatalogSnapshot | undefined,
  ): Map<string, CatalogModel> {
    return new Map((snapshot?.models ?? []).map((model) => [model.id, model]));
  }

  function describeModel(
    endpointLabelText: string,
    id: string,
    known: CatalogModel | undefined,
  ): string {
    const context =
      known?.contextLength === undefined || known.contextLength === null
        ? ""
        : ` · ${known.contextLength.toLocaleString()} context`;
    return `${id} via ${endpointLabelText}${context}`;
  }

  async function announceStatus(): Promise<void> {
    const current = await config();
    const configured = ENDPOINT_IDS.filter(
      (endpoint) => keyFor(current, endpoint).length > 0,
    );
    if (configured.length === 0) {
      bb.status.needsConfiguration(
        "Add an OpenRouter, DeepSeek, or custom endpoint API key.",
      );
      return;
    }
    for (const endpoint of configured) {
      if ((await enabledModels(endpoint)).length === 0) {
        bb.status.needsConfiguration(
          `Choose which ${endpointLabel(current, endpoint)} models to show in the picker.`,
        );
        return;
      }
    }
  }

  void announceStatus();
  settings.onChange(() => {
    void announceStatus();
  });

  for (const harness of HARNESS_IDS) {
    bb.providers.experimental_contributeModels(harness, async () => {
      const current = await config();
      const models: {
        id: string;
        displayName: string;
        description: string;
        qualifier: string;
      }[] = [];
      for (const endpoint of ENDPOINT_IDS) {
        if (resolveEndpoint(current, endpoint, harness).status !== "ready") {
          continue;
        }
        const enabled = await enabledModels(endpoint);
        if (enabled.length === 0) continue;
        const label = endpointLabel(current, endpoint);
        const known = catalogLookup(await cachedCatalog(endpoint));
        for (const id of enabled) {
          const entry = known.get(id);
          models.push({
            id: routedModelId(endpoint, id),
            displayName: entry?.label ?? id,
            description: describeModel(label, id, entry),
            qualifier: label,
          });
        }
      }
      return models;
    });

    bb.providers.experimental_contributeEnv(harness, async (context) => {
      try {
        return harnessEnv(await config(), harness, context.model);
      } catch (error) {
        bb.log.warn(
          `Model Routing contributed nothing for ${harness}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    });

    bb.providers.experimental_contributeEnvHealth(harness, async () => {
      const current = await config();
      const ready = ENDPOINT_IDS.filter(
        (endpoint) =>
          resolveEndpoint(current, endpoint, harness).status === "ready",
      ).map((endpoint) => endpointLabel(current, endpoint));
      if (ready.length === 0) return null;
      return {
        label: "Model Routing",
        statusMessage: `${ready.join(", ")} models are available in the ${HARNESS_LABELS[harness]} picker.`,
      };
    });
  }

  async function endpointStatus(
    current: RoutingConfig,
    endpoint: EndpointId,
  ): Promise<z.infer<typeof endpointStatusSchema>> {
    return {
      id: endpoint,
      label: endpointLabel(current, endpoint),
      configured: keyFor(current, endpoint).length > 0,
      hasCatalog: ENDPOINTS[endpoint].modelsUrl !== null,
      ready: {
        claudeCode:
          resolveEndpoint(current, endpoint, "claude-code").status === "ready",
        codex: resolveEndpoint(current, endpoint, "codex").status === "ready",
      },
      summary: describeEndpoint(current, endpoint),
      enabled: await enabledModels(endpoint),
    };
  }

  async function listPickerModels(
    endpoint: EndpointId,
    refresh: boolean,
  ): Promise<
    | {
        ok: true;
        models: z.infer<typeof pickerModelSchema>[];
        fetchedAt: number;
      }
    | { ok: false; error: string }
  > {
    const enabled = new Set(await enabledModels(endpoint));
    if (endpoint === "custom") {
      return {
        ok: true,
        models: [...enabled].map((id) => ({
          id,
          label: id,
          contextLength: null,
          enabled: true,
        })),
        fetchedAt: Date.now(),
      };
    }
    try {
      const snapshot = await catalogFor(endpoint, refresh);
      return {
        ok: true,
        models: snapshot.models.map((model) => ({
          ...model,
          enabled: enabled.has(model.id),
        })),
        fetchedAt: snapshot.fetchedAt,
      };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async function toggleModel(
    endpoint: EndpointId,
    model: string,
    enabled: boolean,
  ): Promise<string[]> {
    if (endpoint === "custom") {
      throw new Error(
        "Custom endpoint models are listed in the Custom endpoint models setting.",
      );
    }
    const id = model.trim();
    const current = await enabledModels(endpoint);
    const next = enabled
      ? current.includes(id)
        ? current
        : [...current, id]
      : current.filter((entry) => entry !== id);
    await setEnabledModels(endpoint, next);
    void announceStatus();
    return next;
  }

  bb.rpc.register(rpcContract, {
    async status() {
      const current = await config();
      return {
        endpoints: await Promise.all(
          ENDPOINT_IDS.map((endpoint) => endpointStatus(current, endpoint)),
        ),
      };
    },
    models({ endpoint, refresh }) {
      return listPickerModels(endpoint, refresh);
    },
    async setEnabled({ endpoint, model, enabled }) {
      return { enabled: await toggleModel(endpoint, model, enabled) };
    },
  });

  bb.cli.register({
    name: "model-routing",
    summary:
      "Show OpenRouter, DeepSeek, or custom endpoint models in the picker",
    commands: [
      {
        name: "status",
        summary:
          "Show which endpoints have keys and which models are in the picker.",
        usage: "kaioken model-routing status",
      },
      {
        name: "models",
        summary:
          "List the models an endpoint publishes; picker models are marked with *.",
        usage:
          "kaioken model-routing models <openrouter|deepseek|custom> [--refresh]",
      },
      {
        name: "enable",
        summary:
          "Show a model in the Claude Code and Codex pickers as <endpoint>/<model-id>.",
        usage: "kaioken model-routing enable <openrouter|deepseek> <model-id>",
      },
      {
        name: "disable",
        summary: "Remove a model from the pickers.",
        usage: "kaioken model-routing disable <openrouter|deepseek> <model-id>",
      },
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      if (command === "status" || command === undefined) {
        const current = await config();
        const lines: string[] = [];
        for (const endpoint of ENDPOINT_IDS) {
          const status = await endpointStatus(current, endpoint);
          lines.push(
            `${status.label.padEnd(12)} ${status.configured ? status.summary : "no API key"}`,
          );
          for (const id of status.enabled) {
            lines.push(`  ${routedModelId(endpoint, id)}`);
          }
        }
        lines.push(
          "",
          `Pick a harness in the composer, then choose one of the ${HARNESS_IDS.map((harness) => HARNESS_LABELS[harness]).join(" or ")} models listed above.`,
          "",
        );
        return { exitCode: 0, stdout: lines.join("\n") };
      }

      if (command === "models") {
        const endpoint = rest[0];
        if (!isEndpointId(endpoint)) {
          return {
            exitCode: 2,
            stderr:
              "Pass an endpoint: kaioken model-routing models <openrouter|deepseek|custom> [--refresh]\n",
          };
        }
        const result = await listPickerModels(
          endpoint,
          rest.includes("--refresh"),
        );
        if (!result.ok) return { exitCode: 1, stderr: `${result.error}\n` };
        if (result.models.length === 0) {
          return { exitCode: 0, stdout: "No models published.\n" };
        }
        return {
          exitCode: 0,
          stdout: `${result.models
            .map((model) => `${model.enabled ? "* " : "  "}${model.id}`)
            .join("\n")}\n`,
        };
      }

      if (command === "enable" || command === "disable") {
        const endpoint = rest[0];
        const model = rest[1];
        if (!isEndpointId(endpoint) || model === undefined) {
          return {
            exitCode: 2,
            stderr: `Pass an endpoint and a model id: kaioken model-routing ${command} <openrouter|deepseek> <model-id>\n`,
          };
        }
        try {
          const enabled = await toggleModel(
            endpoint,
            model,
            command === "enable",
          );
          return {
            exitCode: 0,
            stdout:
              enabled.length === 0
                ? `No ${ENDPOINTS[endpoint].label} models in the picker.\n`
                : `${enabled.map((id) => routedModelId(endpoint, id)).join("\n")}\n`,
          };
        } catch (error) {
          return {
            exitCode: 1,
            stderr: `${error instanceof Error ? error.message : String(error)}\n`,
          };
        }
      }

      return {
        exitCode: 2,
        stderr: `Unknown command: ${command}\n`,
      };
    },
  });
}
