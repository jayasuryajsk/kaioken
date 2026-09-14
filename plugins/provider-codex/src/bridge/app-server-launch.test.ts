import { afterEach, describe, expect, it, vi } from "vitest";
import { resolveAppServerLaunch } from "./bridge.js";

afterEach(() => vi.unstubAllEnvs());

describe("Codex Account Pool launch", () => {
  it("adds an in-memory base URL and environment-backed hub header", () => {
    vi.stubEnv("CODEX_OPENAI_BASE_URL", "https://kaioken.example/pool/v1");
    vi.stubEnv("CODEX_POOL_AUTH_TOKEN", "secret-machine-token");
    const launch = resolveAppServerLaunch();
    expect(launch.command).toBe("codex");
    expect(launch.args).toContain(
      'openai_base_url="https://kaioken.example/pool/v1"',
    );
    expect(launch.args).toContain('model_provider="kaioken-account-pool"');
    expect(launch.args).toContain(
      'model_providers.kaioken-account-pool.env_http_headers.x-bb-account-pool-token="CODEX_POOL_AUTH_TOKEN"',
    );
    expect(launch.args).toContain(
      "model_providers.kaioken-account-pool.supports_websockets=false",
    );
    expect(JSON.stringify(launch.args)).not.toContain("secret-machine-token");
  });

  it("leaves Codex's default transport alone when the pool is not routed", () => {
    const launch = resolveAppServerLaunch({});
    expect(launch).toEqual({ command: "codex", args: ["app-server"] });
    expect(JSON.stringify(launch.args)).not.toContain("supports_websockets");
  });

  it("does not partially route when either required variable is missing", () => {
    vi.stubEnv("CODEX_OPENAI_BASE_URL", "https://kaioken.example/pool/v1");
    expect(resolveAppServerLaunch()).toEqual({
      command: "codex",
      args: ["app-server"],
    });
  });
});

describe("Codex custom endpoint launch", () => {
  it("declares a responses-wire provider whose key the CLI reads from the environment", () => {
    vi.stubEnv("CODEX_CUSTOM_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("CODEX_CUSTOM_AUTH_TOKEN", "sk-or-secret");
    vi.stubEnv("CODEX_CUSTOM_NAME", "OpenRouter");
    vi.stubEnv("CODEX_CUSTOM_MODEL", "anthropic/claude-sonnet-4.5");
    const launch = resolveAppServerLaunch();
    expect(launch.command).toBe("codex");
    expect(launch.args).toContain('model_provider="kaioken-custom"');
    expect(launch.args).toContain(
      'model_providers.kaioken-custom.name="OpenRouter"',
    );
    expect(launch.args).toContain(
      'model_providers.kaioken-custom.base_url="https://openrouter.ai/api/v1"',
    );
    expect(launch.args).toContain(
      'model_providers.kaioken-custom.wire_api="responses"',
    );
    expect(launch.args).toContain(
      'model_providers.kaioken-custom.env_key="CODEX_CUSTOM_AUTH_TOKEN"',
    );
    expect(launch.args).toContain('model="anthropic/claude-sonnet-4.5"');
    expect(JSON.stringify(launch.args)).not.toContain("sk-or-secret");
  });

  it("falls back to a default name and omits the model when none is set", () => {
    vi.stubEnv("CODEX_CUSTOM_BASE_URL", "https://api.deepseek.com");
    vi.stubEnv("CODEX_CUSTOM_AUTH_TOKEN", "sk-ds-secret");
    const launch = resolveAppServerLaunch();
    expect(launch.args).toContain(
      'model_providers.kaioken-custom.name="Custom"',
    );
    expect(launch.args.some((arg) => arg.startsWith("model="))).toBe(false);
  });

  it("does not route when either required variable is missing", () => {
    vi.stubEnv("CODEX_CUSTOM_BASE_URL", "https://api.deepseek.com");
    expect(resolveAppServerLaunch()).toEqual({
      command: "codex",
      args: ["app-server"],
    });
  });

  it("leaves the account pool in charge when both are configured", () => {
    vi.stubEnv("CODEX_OPENAI_BASE_URL", "https://kaioken.example/pool/v1");
    vi.stubEnv("CODEX_POOL_AUTH_TOKEN", "secret-machine-token");
    vi.stubEnv("CODEX_CUSTOM_BASE_URL", "https://openrouter.ai/api/v1");
    vi.stubEnv("CODEX_CUSTOM_AUTH_TOKEN", "sk-or-secret");
    const launch = resolveAppServerLaunch();
    expect(launch.args).toContain('model_provider="kaioken-account-pool"');
    expect(JSON.stringify(launch.args)).not.toContain("kaioken-custom");
  });
});
