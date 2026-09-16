import { describe, expect, it } from "vitest";
import {
  claudeCodeEnv,
  codexEnv,
  describeEndpoint,
  parseRoutedModelId,
  resolveEndpoint,
  routedModelId,
  type EnvEntry,
  type RoutingConfig,
} from "./routing";

function config(overrides: Partial<RoutingConfig> = {}): RoutingConfig {
  return {
    openrouterKey: "",
    deepseekKey: "",
    customLabel: "",
    customBaseUrl: "",
    customResponsesBaseUrl: "",
    customKey: "",
    ...overrides,
  };
}

function byName(entries: EnvEntry[]) {
  return new Map(entries.map((entry) => [entry.name, entry]));
}

const MUSE = "openrouter/meta/muse-spark-1.3-contributor";

describe("routed model ids", () => {
  it("round-trips an endpoint prefix and keeps slashes inside the model", () => {
    expect(routedModelId("openrouter", "meta/muse-spark-1.3-contributor")).toBe(
      MUSE,
    );
    expect(parseRoutedModelId(MUSE)).toEqual({
      endpoint: "openrouter",
      model: "meta/muse-spark-1.3-contributor",
    });
    expect(parseRoutedModelId("deepseek/deepseek-chat")).toEqual({
      endpoint: "deepseek",
      model: "deepseek-chat",
    });
  });

  it("rejects native model ids and empty models", () => {
    expect(parseRoutedModelId("claude-fable-5-1")).toBeNull();
    expect(parseRoutedModelId("gpt-5-codex")).toBeNull();
    expect(parseRoutedModelId("anthropic/claude-sonnet-4.5")).toBeNull();
    expect(parseRoutedModelId("openrouter/")).toBeNull();
    expect(parseRoutedModelId("/x")).toBeNull();
  });
});

describe("claudeCodeEnv", () => {
  it("contributes nothing for a native model id", () => {
    expect(
      claudeCodeEnv(config({ openrouterKey: "key" }), "claude-fable-5-1"),
    ).toEqual([]);
  });

  it("contributes nothing when the routed endpoint has no key", () => {
    expect(claudeCodeEnv(config(), MUSE)).toEqual([]);
  });

  it("sends the picked model on every Claude Code model variable with a bearer token", () => {
    const entries = byName(
      claudeCodeEnv(config({ openrouterKey: "or-key" }), MUSE),
    );
    expect(entries.get("ANTHROPIC_BASE_URL")?.value).toBe(
      "https://openrouter.ai/api",
    );
    expect(entries.get("ANTHROPIC_AUTH_TOKEN")?.value).toBe("or-key");
    expect(entries.get("ANTHROPIC_API_KEY")?.value).toBe("");
    for (const name of [
      "ANTHROPIC_MODEL",
      "ANTHROPIC_DEFAULT_OPUS_MODEL",
      "ANTHROPIC_DEFAULT_SONNET_MODEL",
      "ANTHROPIC_DEFAULT_HAIKU_MODEL",
      "ANTHROPIC_SMALL_FAST_MODEL",
      "CLAUDE_CODE_SUBAGENT_MODEL",
    ]) {
      expect(entries.get(name)?.value).toBe("meta/muse-spark-1.3-contributor");
    }
    expect(
      [...entries.values()].filter((entry) => entry.secret).map((e) => e.name),
    ).toEqual(["ANTHROPIC_AUTH_TOKEN"]);
  });

  it("sends an api key and blanks the bearer token for DeepSeek", () => {
    const entries = byName(
      claudeCodeEnv(
        config({ deepseekKey: "ds-key" }),
        "deepseek/deepseek-chat",
      ),
    );
    expect(entries.get("ANTHROPIC_BASE_URL")?.value).toBe(
      "https://api.deepseek.com/anthropic",
    );
    expect(entries.get("ANTHROPIC_API_KEY")?.value).toBe("ds-key");
    expect(entries.get("ANTHROPIC_AUTH_TOKEN")?.value).toBe("");
    expect(entries.get("ANTHROPIC_MODEL")?.value).toBe("deepseek-chat");
  });

  it("uses the custom anthropic base url and label, and rejects a malformed one", () => {
    const ready = byName(
      claudeCodeEnv(
        config({
          customKey: "c-key",
          customLabel: "Lab proxy",
          customBaseUrl: "https://proxy.example/anthropic/",
        }),
        "custom/lab-model",
      ),
    );
    expect(ready.get("ANTHROPIC_BASE_URL")?.value).toBe(
      "https://proxy.example/anthropic",
    );
    expect(ready.get("ANTHROPIC_BASE_URL")?.reason).toContain("Lab proxy");
    expect(
      claudeCodeEnv(
        config({ customKey: "c-key", customBaseUrl: "not a url" }),
        "custom/lab-model",
      ),
    ).toEqual([]);
  });
});

describe("codexEnv", () => {
  it("contributes nothing for native ids or without a key", () => {
    expect(codexEnv(config({ openrouterKey: "k" }), "gpt-5-codex")).toEqual([]);
    expect(codexEnv(config(), MUSE)).toEqual([]);
  });

  it("points Codex at the responses base url with the picked model", () => {
    const entries = byName(codexEnv(config({ openrouterKey: "or-key" }), MUSE));
    expect(entries.get("CODEX_CUSTOM_BASE_URL")?.value).toBe(
      "https://openrouter.ai/api/v1",
    );
    expect(entries.get("CODEX_CUSTOM_AUTH_TOKEN")).toMatchObject({
      value: "or-key",
      secret: true,
    });
    expect(entries.get("CODEX_CUSTOM_NAME")?.value).toBe("OpenRouter");
    expect(entries.get("CODEX_CUSTOM_MODEL")?.value).toBe(
      "meta/muse-spark-1.3-contributor",
    );
  });

  it("needs its own custom base url, separate from the Claude Code one", () => {
    expect(
      codexEnv(
        config({ customKey: "c", customBaseUrl: "https://proxy.example/a" }),
        "custom/lab-model",
      ),
    ).toEqual([]);
    const entries = byName(
      codexEnv(
        config({
          customKey: "c",
          customResponsesBaseUrl: "https://proxy.example/v1",
        }),
        "custom/lab-model",
      ),
    );
    expect(entries.get("CODEX_CUSTOM_BASE_URL")?.value).toBe(
      "https://proxy.example/v1",
    );
  });
});

describe("resolveEndpoint and describeEndpoint", () => {
  it("names the harness in a missing-key message", () => {
    const resolution = resolveEndpoint(config(), "openrouter", "codex");
    expect(resolution.status).toBe("incomplete");
    if (resolution.status === "incomplete") {
      expect(resolution.reason).toContain("Codex");
    }
  });

  it("summarises readiness per harness", () => {
    expect(describeEndpoint(config({ openrouterKey: "k" }), "openrouter")).toBe(
      "OpenRouter — Claude Code ready; Codex ready",
    );
    expect(
      describeEndpoint(
        config({ customKey: "k", customBaseUrl: "https://p.example/a" }),
        "custom",
      ),
    ).toContain("Codex: Set a custom Responses base URL");
  });
});
