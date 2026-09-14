import { describe, expect, it } from "vitest";
import {
  claudeCodeEnv,
  describeRoute,
  resolveRoute,
  ROUTE_OPTION_LABELS,
  routeIdFromLabel,
  type RoutingConfig,
} from "./routing";

function config(overrides: Partial<RoutingConfig> = {}): RoutingConfig {
  return {
    route: "default",
    model: "",
    openrouterKey: "",
    deepseekKey: "",
    customLabel: "",
    customBaseUrl: "",
    customKey: "",
    ...overrides,
  };
}

function byName(entries: ReturnType<typeof claudeCodeEnv>) {
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
    expect(claudeCodeEnv(config({ route: "openrouter" }))).toEqual([]);
    expect(
      claudeCodeEnv(config({ route: "openrouter", openrouterKey: "   " })),
    ).toEqual([]);
  });

  it("sends a bearer token and blanks the api key for OpenRouter", () => {
    const entries = byName(
      claudeCodeEnv(
        config({
          route: "openrouter",
          openrouterKey: "sk-or-123",
          model: "anthropic/claude-sonnet-4.5",
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
          route: "deepseek",
          deepseekKey: "sk-ds-456",
          model: "deepseek-flash",
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
      config({ route: "deepseek", deepseekKey: "sk-ds-456" }),
    ).map((entry) => entry.name);
    expect(names).not.toContain("ANTHROPIC_MODEL");
  });

  it("marks exactly the credential as secret", () => {
    for (const entry of claudeCodeEnv(
      config({ route: "openrouter", openrouterKey: "sk-or-123" }),
    )) {
      expect(entry.secret).toBe(entry.name === "ANTHROPIC_AUTH_TOKEN");
      expect(entry.reason.length).toBeGreaterThan(0);
      expect(entry.name).toMatch(/^[A-Z_][A-Z0-9_]*$/u);
    }
  });

  it("uses the custom base url and label, and rejects a malformed one", () => {
    const entries = byName(
      claudeCodeEnv(
        config({
          route: "custom",
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
        config({ route: "custom", customKey: "sk-x", customBaseUrl: "nope" }),
      ),
    ).toEqual([]);
  });
});

describe("resolveRoute and describeRoute", () => {
  it("explains a missing key and a missing base url", () => {
    const missingKey = resolveRoute(config({ route: "deepseek" }));
    expect(missingKey.status).toBe("incomplete");
    expect(describeRoute(config({ route: "deepseek" }))).toContain(
      "DeepSeek API key",
    );
    expect(
      describeRoute(config({ route: "custom", customKey: "k" })),
    ).toContain("base URL");
  });

  it("summarises a ready route and the default route", () => {
    expect(describeRoute(config())).toContain("Default");
    expect(
      describeRoute(
        config({
          route: "openrouter",
          openrouterKey: "sk-or-123",
          model: "x/y",
        }),
      ),
    ).toBe("Routed to OpenRouter at https://openrouter.ai/api, using x/y.");
  });
});
