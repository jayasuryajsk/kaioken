import {
  defineRpcContract,
  type KaiokenPluginApi,
} from "@get-kaioken/plugin-sdk";
import { z } from "zod";
import { fetchCatalog, isStale, type CatalogSnapshot } from "./lib/catalog";
import {
  describeRoute,
  ENDPOINTS,
  HARNESS_IDS,
  HARNESS_LABELS,
  harnessEnv,
  resolveRoute,
  ROUTE_IDS,
  ROUTE_OPTION_LABELS,
  routeIdFromLabel,
  type EndpointId,
  type HarnessId,
  type RoutingConfig,
} from "./lib/routing";

const CATALOG_PREFIX = "catalog:";

const catalogModelSchema = z.object({
  id: z.string(),
  label: z.string(),
  contextLength: z.number().nullable(),
});

export const rpcContract = defineRpcContract({
  status: {
    input: z.object({}).strict(),
    output: z.object({
      harnesses: z.array(
        z.object({
          id: z.enum(HARNESS_IDS),
          label: z.string(),
          route: z.enum(ROUTE_IDS),
          model: z.string(),
          summary: z.string(),
          ready: z.boolean(),
        }),
      ),
      configuredEndpoints: z.array(z.string()),
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
    input: z
      .object({ harness: z.enum(HARNESS_IDS), model: z.string() })
      .strict(),
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
    codexRoute: {
      type: "select",
      label: "Codex endpoint",
      description:
        "Where Codex sends its requests. The endpoint must speak the OpenAI Responses API, which OpenRouter and DeepSeek both do.",
      options: ROUTE_IDS.map((id) => ROUTE_OPTION_LABELS[id]),
      default: ROUTE_OPTION_LABELS.default,
    },
    codexModel: {
      type: "string",
      label: "Codex model",
      description:
        "Model id Codex asks for, for example anthropic/claude-sonnet-4.5 or deepseek-flash. Leave empty for the endpoint default.",
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
  });

  async function config(): Promise<RoutingConfig> {
    const values = await settings.get();
    return {
      harnesses: {
        "claude-code": {
          route: routeIdFromLabel(values.claudeCodeRoute),
          model: values.claudeCodeModel ?? "",
        },
        codex: {
          route: routeIdFromLabel(values.codexRoute),
          model: values.codexModel ?? "",
        },
      },
      openrouterKey: values.openrouterKey ?? "",
      deepseekKey: values.deepseekKey ?? "",
      customLabel: values.customLabel ?? "",
      customBaseUrl: values.customBaseUrl ?? "",
      customResponsesBaseUrl: values.customResponsesBaseUrl ?? "",
      customKey: values.customKey ?? "",
    };
  }

  function isHarnessId(value: string | undefined): value is HarnessId {
    return HARNESS_IDS.some((harness) => harness === value);
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
    for (const harness of HARNESS_IDS) {
      const resolution = resolveRoute(current, harness);
      if (resolution.status === "incomplete") {
        bb.status.needsConfiguration(resolution.reason);
        return;
      }
    }
  }

  void announceStatus();
  settings.onChange(() => {
    void announceStatus();
  });

  for (const harness of HARNESS_IDS) {
    bb.providers.experimental_contributeEnv(harness, async () => {
      try {
        return harnessEnv(await config(), harness);
      } catch (error) {
        bb.log.warn(
          `Model Routing contributed nothing for ${harness}: ${error instanceof Error ? error.message : String(error)}`,
        );
        return [];
      }
    });

    bb.providers.experimental_contributeEnvHealth(harness, async () => {
      const resolution = resolveRoute(await config(), harness);
      if (resolution.status !== "ready") return null;
      return {
        label: resolution.route.label,
        statusMessage: `Requests go to ${resolution.route.baseUrl} with your ${resolution.route.label} key.`,
      };
    });
  }

  bb.rpc.register(rpcContract, {
    async status() {
      const current = await config();
      return {
        harnesses: HARNESS_IDS.map((harness) => ({
          id: harness,
          label: HARNESS_LABELS[harness],
          route: current.harnesses[harness].route,
          model: current.harnesses[harness].model,
          summary: describeRoute(current, harness),
          ready: resolveRoute(current, harness).status === "ready",
        })),
        configuredEndpoints: configuredEndpoints(current),
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
    async selectModel({ harness, model }) {
      await settings.experimental_set(
        harness === "claude-code"
          ? { claudeCodeModel: model.trim() }
          : { codexModel: model.trim() },
      );
      const current = await config();
      return {
        model: current.harnesses[harness].model,
        summary: describeRoute(current, harness),
      };
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
        summary: "Set the model a harness asks for.",
        usage: "kaioken model-routing use <claude-code|codex> <model-id>",
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
            ...HARNESS_IDS.map(
              (harness) =>
                `${HARNESS_LABELS[harness].padEnd(12)} ${describeRoute(current, harness)}`,
            ),
            `${"Keys".padEnd(12)} ${configured.length > 0 ? configured.join(", ") : "none configured"}`,
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
        const harness = rest[0];
        const model = rest[1];
        if (!isHarnessId(harness) || model === undefined) {
          return {
            exitCode: 2,
            stderr:
              "Pass a harness and a model id: kaioken model-routing use <claude-code|codex> <model-id>\n",
          };
        }
        await settings.experimental_set(
          harness === "claude-code"
            ? { claudeCodeModel: model.trim() }
            : { codexModel: model.trim() },
        );
        return {
          exitCode: 0,
          stdout: `${describeRoute(await config(), harness)}\n`,
        };
      }

      return {
        exitCode: 2,
        stderr: `Unknown command: ${command}\n`,
      };
    },
  });
}
