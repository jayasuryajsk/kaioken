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
