import {
  defineRpcContract,
  type KaiokenPluginApi,
} from "@get-kaioken/plugin-sdk";
import { z } from "zod";
import { fetchCatalog, isStale, type CatalogSnapshot } from "./lib/catalog";
import {
  claudeCodeEnv,
  describeRoute,
  ENDPOINTS,
  resolveRoute,
  ROUTE_IDS,
  ROUTE_OPTION_LABELS,
  routeIdFromLabel,
  type EndpointId,
  type RoutingConfig,
} from "./lib/routing";

const CATALOG_PREFIX = "catalog:";

const CODEX_LIMITATION =
  "Codex cannot be routed yet: its bridge hardcodes an OpenAI-responses model provider, and OpenRouter and DeepSeek speak chat-completions.";

const catalogModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  contextLength: z.number().nullable(),
});

export const rpcContract = defineRpcContract({
  status: {
    input: z.object({}).strict(),
    output: z.object({
      route: z.enum(ROUTE_IDS),
      model: z.string(),
      summary: z.string(),
      ready: z.boolean(),
      configuredEndpoints: z.array(z.string()),
      codexLimitation: z.string(),
    }),
  },
  models: {
    input: z
      .object({ endpoint: z.enum(["openrouter", "deepseek", "custom"]) })
      .strict(),
    output: z.union([
      z.object({
        ok: z.literal(true),
        models: z.array(catalogModelSchema),
        fetchedAt: z.number(),
      }),
      z.object({ ok: z.literal(false), error: z.string() }),
    ]),
  },
  selectModel: {
    input: z.object({ model: z.string() }).strict(),
    output: z.object({ model: z.string(), summary: z.string() }),
  },
});

export default function plugin(bb: KaiokenPluginApi) {
  const settings = bb.settings.define({
    claudeCodeRoute: {
      type: "select",
      label: "Claude Code endpoint",
      description:
        "Where Claude Code sends its requests. Default leaves your existing sign-in alone.",
      options: ROUTE_IDS.map((id) => ROUTE_OPTION_LABELS[id]),
      default: ROUTE_OPTION_LABELS.default,
    },
    claudeCodeModel: {
      type: "string",
      label: "Claude Code model",
      description:
        "Model id sent as ANTHROPIC_MODEL, for example anthropic/claude-sonnet-4.5 or deepseek-flash. Leave empty for the endpoint default.",
      default: "",
    },
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
      description: "Shown wherever this route is described.",
      default: "",
    },
    customBaseUrl: {
      type: "string",
      label: "Custom base URL",
      description:
        "Must speak the Anthropic Messages API. Claude Code cannot talk to an OpenAI-shaped endpoint directly.",
      default: "",
    },
    customKey: {
      type: "string",
      label: "Custom API key",
      description: "Sent as a bearer token to the custom base URL.",
      secret: true,
    },
  });

  async function config(): Promise<RoutingConfig> {
    const values = await settings.get();
    return {
      route: routeIdFromLabel(values.claudeCodeRoute),
      model: values.claudeCodeModel ?? "",
      openrouterKey: values.openrouterKey ?? "",
      deepseekKey: values.deepseekKey ?? "",
      customLabel: values.customLabel ?? "",
      customBaseUrl: values.customBaseUrl ?? "",
      customKey: values.customKey ?? "",
    };
  }

  function keyFor(current: RoutingConfig, endpoint: EndpointId): string {
    if (endpoint === "openrouter") return current.openrouterKey;
    if (endpoint === "deepseek") return current.deepseekKey;
    return current.customKey;
  }

  function configuredEndpoints(current: RoutingConfig): string[] {
    return (Object.keys(ENDPOINTS) as EndpointId[])
      .filter((id) => keyFor(current, id).trim().length > 0)
      .map((id) => ENDPOINTS[id].label);
  }

  async function catalogFor(
    endpoint: EndpointId,
    refresh: boolean,
  ): Promise<CatalogSnapshot> {
    const key = `${CATALOG_PREFIX}${endpoint}`;
    const cached = await bb.storage.kv.get<CatalogSnapshot>(key);
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
    await bb.storage.kv.set(key, snapshot);
    return snapshot;
  }

  async function announceStatus(): Promise<void> {
    const current = await config();
    const resolution = resolveRoute(current);
    if (resolution.status === "incomplete") {
      bb.status.needsConfiguration(resolution.reason);
    }
  }

  void announceStatus();
  settings.onChange(() => {
    void announceStatus();
  });

  bb.providers.experimental_contributeEnv("claude-code", async () => {
    try {
      return claudeCodeEnv(await config());
    } catch (error) {
      bb.log.warn(
        `Model Routing contributed nothing: ${error instanceof Error ? error.message : String(error)}`,
      );
      return [];
    }
  });

  bb.providers.experimental_contributeEnvHealth("claude-code", async () => {
    const resolution = resolveRoute(await config());
    if (resolution.status !== "ready") return null;
    return {
      label: resolution.route.label,
      statusMessage: `Requests go to ${resolution.route.baseUrl} with your ${resolution.route.label} key.`,
    };
  });

  bb.rpc.register(rpcContract, {
    async status() {
      const current = await config();
      const resolution = resolveRoute(current);
      return {
        route: current.route,
        model: current.model,
        summary: describeRoute(current),
        ready: resolution.status === "ready",
        configuredEndpoints: configuredEndpoints(current),
        codexLimitation: CODEX_LIMITATION,
      };
    },
    async models({ endpoint }) {
      try {
        const snapshot = await catalogFor(endpoint, false);
        return {
          ok: true as const,
          models: snapshot.models,
          fetchedAt: snapshot.fetchedAt,
        };
      } catch (error) {
        return {
          ok: false as const,
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
    async selectModel({ model }) {
      await settings.experimental_set({ claudeCodeModel: model.trim() });
      const current = await config();
      return { model: current.model, summary: describeRoute(current) };
    },
  });

  bb.cli.register({
    name: "model-routing",
    summary: "Route a coding agent at your own model endpoint",
    commands: [
      {
        name: "status",
        summary: "Show where each harness sends its requests.",
        usage: "kaioken model-routing status",
      },
      {
        name: "models",
        summary: "List the models an endpoint publishes.",
        usage: "kaioken model-routing models <openrouter|deepseek|custom>",
      },
      {
        name: "use",
        summary: "Set the model Claude Code asks for.",
        usage: "kaioken model-routing use <model-id>",
      },
    ],
    async run(argv) {
      const [command, ...rest] = argv;
      if (command === "status" || command === undefined) {
        const current = await config();
        const configured = configuredEndpoints(current);
        return {
          exitCode: 0,
          stdout: [
            `Claude Code: ${describeRoute(current)}`,
            `Codex:       ${CODEX_LIMITATION}`,
            `Keys:        ${configured.length > 0 ? configured.join(", ") : "none configured"}`,
            "",
          ].join("\n"),
        };
      }

      if (command === "models") {
        const endpoint = rest[0];
        if (
          endpoint !== "openrouter" &&
          endpoint !== "deepseek" &&
          endpoint !== "custom"
        ) {
          return {
            exitCode: 2,
            stderr:
              "Pass an endpoint: kaioken model-routing models <openrouter|deepseek|custom>\n",
          };
        }
        try {
          const snapshot = await catalogFor(endpoint, false);
          if (snapshot.models.length === 0) {
            return { exitCode: 0, stdout: "No models published.\n" };
          }
          return {
            exitCode: 0,
            stdout: `${snapshot.models.map((model) => model.id).join("\n")}\n`,
          };
        } catch (error) {
          return {
            exitCode: 1,
            stderr: `${error instanceof Error ? error.message : String(error)}\n`,
          };
        }
      }

      if (command === "use") {
        const model = rest[0];
        if (model === undefined) {
          return {
            exitCode: 2,
            stderr: "Pass a model id: kaioken model-routing use <model-id>\n",
          };
        }
        await settings.experimental_set({ claudeCodeModel: model.trim() });
        return { exitCode: 0, stdout: `${describeRoute(await config())}\n` };
      }

      return {
        exitCode: 2,
        stderr: `Unknown command: ${command}\n`,
      };
    },
  });
}
