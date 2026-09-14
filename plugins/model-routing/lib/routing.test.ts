import { describe, expect, it } from "vitest";
import {
  claudeCodeEnv,
  codexEnv,
  describeRoute,
  resolveRoute,
  ROUTE_OPTION_LABELS,
  routeIdFromLabel,
  type EnvEntry,
  type RouteId,
  type RoutingConfig,
} from "./routing";

interface ConfigOverrides {
  claudeCode?: { route?: RouteId; model?: string };
  codex?: { route?: RouteId; model?: string };
  openrouterKey?: string;
  deepseekKey?: string;
  customLabel?: string;
  customBaseUrl?: string;
  customResponsesBaseUrl?: string;
  customKey?: string;
}

function config(overrides: ConfigOverrides = {}): RoutingConfig {
  return {
    harnesses: {
      "claude-code": {
        route: overrides.claudeCode?.route ?? "default",
        model: overrides.claudeCode?.model ?? "",
      },
      codex: {
        route: overrides.codex?.route ?? "default",
        model: overrides.codex?.model ?? "",
      },
    },
    openrouterKey: overrides.openrouterKey ?? "",
    deepseekKey: overrides.deepseekKey ?? "",
    customLabel: overrides.customLabel ?? "",
    customBaseUrl: overrides.customBaseUrl ?? "",
    customResponsesBaseUrl: overrides.customResponsesBaseUrl ?? "",
    customKey: overrides.customKey ?? "",
  };
}

function byName(entries: EnvEntry[]) {
  return new Map(entries.map((entry) => [entry.name, entry]));
}

describe("routeIdFromLabel", () => {
  it("maps every option label back to its id and falls back to default", () => {
    expect(routeIdFromLabel(ROUTE_OPTION_LABELS.openrouter)).toBe("openrouter");
    expect(routeIdFromLabel(ROUTE_OPTION_LABELS.deepseek)).toBe("deepseek");
    expect(routeIdFromLabel(ROUTE_OPTION_LABELS.custom)).toBe("custom");
    expect(routeIdFromLabel("something else")).toBe("default");
  });
});

describe("claudeCodeEnv", () => {
  it("contributes nothing on the default route", () => {
    expect(claudeCodeEnv(config({ openrouterKey: "sk-or-123" }))).toEqual([]);
  });

  it("contributes nothing when the chosen endpoint has no key", () => {
    expect(
      claudeCodeEnv(config({ claudeCode: { route: "openrouter" } })),
    ).toEqual([]);
    expect(
      claudeCodeEnv(
        config({ claudeCode: { route: "openrouter" }, openrouterKey: "   " }),
      ),
    ).toEqual([]);
  });

  it("sends a bearer token and blanks the api key for OpenRouter", () => {
    const entries = byName(
      claudeCodeEnv(
        config({
          claudeCode: {
            route: "openrouter",
            model: "anthropic/claude-sonnet-4.5",
          },
          openrouterKey: "sk-or-123",
        }),
      ),
    );
    expect(entries.get("ANTHROPIC_BASE_URL")?.value).toBe(
      "https://openrouter.ai/api",
    );
    expect(entries.get("ANTHROPIC_AUTH_TOKEN")).toMatchObject({
      value: "sk-or-123",
      secret: true,
    });
    expect(entries.get("ANTHROPIC_API_KEY")).toMatchObject({
      value: "",
      secret: false,
    });
    expect(entries.get("ANTHROPIC_MODEL")?.value).toBe(
      "anthropic/claude-sonnet-4.5",
    );
  });

  it("sends an api key and blanks the bearer token for DeepSeek", () => {
    const entries = byName(
      claudeCodeEnv(
        config({
          claudeCode: { route: "deepseek", model: "deepseek-flash" },
          deepseekKey: "sk-ds-456",
        }),
      ),
    );
    expect(entries.get("ANTHROPIC_BASE_URL")?.value).toBe(
      "https://api.deepseek.com/anthropic",
    );
    expect(entries.get("ANTHROPIC_API_KEY")).toMatchObject({
      value: "sk-ds-456",
      secret: true,
    });
    expect(entries.get("ANTHROPIC_AUTH_TOKEN")?.value).toBe("");
  });

  it("omits the model when none is chosen", () => {
    const names = claudeCodeEnv(
      config({ claudeCode: { route: "deepseek" }, deepseekKey: "sk-ds-456" }),
    ).map((entry) => entry.name);
    expect(names).not.toContain("ANTHROPIC_MODEL");
  });

  it("marks exactly the credential as secret", () => {
    for (const entry of claudeCodeEnv(
      config({ claudeCode: { route: "openrouter" }, openrouterKey: "sk-or" }),
    )) {
      expect(entry.secret).toBe(entry.name === "ANTHROPIC_AUTH_TOKEN");
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.name).toMatch(/^[A-Z_][A-Z0-9_]*$/u);
    }
  });

  it("uses the custom anthropic base url and label, and rejects a malformed one", () => {
    const entries = byName(
      claudeCodeEnv(
        config({
          claudeCode: { route: "custom" },
          customKey: "sk-x",
          customLabel: "Home rig",
          customBaseUrl: "https://rig.example.com/anthropic/",
        }),
      ),
    );
    expect(entries.get("ANTHROPIC_BASE_URL")?.value).toBe(
      "https://rig.example.com/anthropic",
    );
    expect(entries.get("ANTHROPIC_AUTH_TOKEN")?.reason).toContain("Home rig");
    expect(
      claudeCodeEnv(
        config({
          claudeCode: { route: "custom" },
          customKey: "sk-x",
          customBaseUrl: "nope",
        }),
      ),
    ).toEqual([]);
  });
});

describe("codexEnv", () => {
  it("contributes nothing on the default route or without a key", () => {
    expect(codexEnv(config({ openrouterKey: "sk-or-123" }))).toEqual([]);
    expect(codexEnv(config({ codex: { route: "openrouter" } }))).toEqual([]);
  });

  it("points Codex at the responses base url and names the env var for env_key", () => {
    const entries = byName(
      codexEnv(
        config({
          codex: { route: "openrouter", model: "anthropic/claude-sonnet-4.5" },
          openrouterKey: "sk-or-123",
        }),
      ),
    );
    expect(entries.get("CODEX_CUSTOM_BASE_URL")?.value).toBe(
      "https://openrouter.ai/api/v1",
    );
    expect(entries.get("CODEX_CUSTOM_AUTH_TOKEN")).toMatchObject({
      value: "sk-or-123",
      secret: true,
    });
    expect(entries.get("CODEX_CUSTOM_NAME")?.value).toBe("OpenRouter");
    expect(entries.get("CODEX_CUSTOM_MODEL")?.value).toBe(
      "anthropic/claude-sonnet-4.5",
    );
  });

  it("uses DeepSeek's responses root rather than its anthropic path", () => {
    const entries = byName(
      codexEnv(
        config({ codex: { route: "deepseek" }, deepseekKey: "sk-ds-456" }),
      ),
    );
    expect(entries.get("CODEX_CUSTOM_BASE_URL")?.value).toBe(
      "https://api.deepseek.com",
    );
    expect(entries.get("CODEX_CUSTOM_AUTH_TOKEN")).toMatchObject({
      value: "sk-ds-456",
      secret: true,
    });
    expect(entries.has("CODEX_CUSTOM_MODEL")).toBe(false);
  });

  it("marks exactly the credential as secret", () => {
    for (const entry of codexEnv(
      config({
        codex: { route: "openrouter", model: "x/y" },
        openrouterKey: "sk-or",
      }),
    )) {
      expect(entry.secret).toBe(entry.name === "CODEX_CUSTOM_AUTH_TOKEN");
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.name).toMatch(/^[A-Z_][A-Z0-9_]*$/u);
    }
  });

  it("needs its own custom base url, separate from the Claude Code one", () => {
    const anthropicOnly = config({
      codex: { route: "custom" },
      customKey: "sk-x",
      customBaseUrl: "https://rig.example.com/anthropic",
    });
    expect(codexEnv(anthropicOnly)).toEqual([]);
    expect(describeRoute(anthropicOnly, "codex")).toContain("Responses");
    expect(
      byName(
        codexEnv(
          config({
            codex: { route: "custom" },
            customKey: "sk-x",
            customResponsesBaseUrl: "https://rig.example.com/v1/",
          }),
        ),
      ).get("CODEX_CUSTOM_BASE_URL")?.value,
    ).toBe("https://rig.example.com/v1");
  });
});

describe("resolveRoute and describeRoute", () => {
  it("keeps the two harnesses independent", () => {
    const mixed = config({
      claudeCode: { route: "openrouter" },
      codex: { route: "default" },
      openrouterKey: "sk-or-123",
    });
    expect(resolveRoute(mixed, "claude-code").status).toBe("ready");
    expect(resolveRoute(mixed, "codex").status).toBe("default");
    expect(codexEnv(mixed)).toEqual([]);
    expect(claudeCodeEnv(mixed).length).toBeGreaterThan(0);
  });

  it("names the harness in a missing-key message", () => {
    expect(
      describeRoute(config({ codex: { route: "deepseek" } }), "codex"),
    ).toBe("Add the DeepSeek API key before routing Codex.");
    expect(
      describeRoute(
        config({ claudeCode: { route: "deepseek" } }),
        "claude-code",
      ),
    ).toContain("Claude Code");
  });

  it("summarises a ready route and the default route", () => {
    expect(describeRoute(config(), "claude-code")).toContain("Default");
    expect(
      describeRoute(
        config({
          claudeCode: { route: "openrouter", model: "x/y" },
          openrouterKey: "sk-or-123",
        }),
        "claude-code",
      ),
    ).toBe("Routed to OpenRouter at https://openrouter.ai/api, using x/y.");
  });
});
