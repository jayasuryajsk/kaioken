import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadCliConfig } from "../src/cli.js";
import { loadCommonConfig } from "../src/common.js";
import { loadDatabaseConfig } from "../src/database.js";
import { loadDevAppConfig } from "../src/dev-app.js";
import { loadHostDaemonEntrypointConfig } from "../src/host-daemon-entrypoint.js";
import {
  loadHostDaemonConfig,
  loadHostDaemonConnectionConfig,
  loadHostDaemonStartConfig,
} from "../src/host-daemon.js";
import { parseProviderModelConfig } from "../src/inference-model.js";
import { loadLoggerConfig } from "../src/logger.js";
import {
  resolveConfiguredDataDir,
  parsePortValue,
  resolvePortFromEnv,
  resolveRuntimeDataDir,
} from "../src/runtime.js";
import { loadServerPortConfig } from "../src/server-port.js";
import { loadServerConfig } from "../src/server.js";
import { loadViteDevConfig } from "../src/vite-dev.js";

async function importConfigModules(): Promise<void> {
  vi.resetModules();
  await Promise.all([
    import("../src/cli.js"),
    import("../src/common.js"),
    import("../src/database.js"),
    import("../src/dev-app.js"),
    import("../src/host-daemon-entrypoint.js"),
    import("../src/host-daemon.js"),
    import("../src/logger.js"),
    import("../src/objects.js"),
    import("../src/server-port.js"),
    import("../src/server-url.js"),
    import("../src/server.js"),
    import("../src/vite-dev.js"),
  ]);
}

function createServerRuntimeEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    KAIOKEN_DATA_DIR: "/tmp/kaioken-data",
    KAIOKEN_HOST_DAEMON_PORT: "5555",
    KAIOKEN_SERVER_PORT: "4444",
    NODE_ENV: "development",
    OPENAI_API_KEY: "test-openai-key",
    ...overrides,
  };
}

function createHostDaemonRuntimeEnv(
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv {
  return {
    KAIOKEN_HOST_DAEMON_PORT: "5555",
    KAIOKEN_SERVER_URL: "http://localhost:4444",
    NODE_ENV: "development",
    ...overrides,
  };
}

describe("config module boundaries", () => {
  it("does not validate environment at import time", async () => {
    await expect(importConfigModules()).resolves.toBeUndefined();
  });
});

describe("common config", () => {
  it("uses the production data dir default in production", () => {
    expect(
      loadCommonConfig({
        env: {
          NODE_ENV: "production",
        },
        homeDir: "/Users/tester",
      }).KAIOKEN_DATA_DIR,
    ).toBe("/Users/tester/.kaioken");
  });

  it("requires repoRoot or KAIOKEN_DATA_DIR for development data dir resolution", () => {
    expect(() =>
      loadCommonConfig({
        env: {
          NODE_ENV: "development",
        },
        homeDir: "/Users/tester",
      }),
    ).toThrow("repoRoot is required to resolve development KAIOKEN_DATA_DIR");
  });

  it("resolves development defaults from the checkout instance", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/src/kaioken";

    expect(
      loadCommonConfig({
        env: {
          NODE_ENV: "development",
        },
        homeDir,
        repoRoot,
      }).KAIOKEN_DATA_DIR,
    ).toBe("/Users/tester/.kaioken-dev/src-kaioken-db812558aad7");
  });

  it("expands home-directory overrides for KAIOKEN_DATA_DIR", () => {
    expect(
      loadCommonConfig({
        env: {
          KAIOKEN_DATA_DIR: "~/custom-kaioken",
          NODE_ENV: "production",
        },
      }).KAIOKEN_DATA_DIR,
    ).toBe(path.join(os.homedir(), "custom-kaioken"));
  });

  it("rejects whitespace-only KAIOKEN_DATA_DIR overrides", () => {
    expect(() =>
      loadCommonConfig({
        env: {
          KAIOKEN_DATA_DIR: "   ",
          NODE_ENV: "production",
        },
      }),
    ).toThrow("KAIOKEN_DATA_DIR must not be empty");
  });

  it("rejects unsupported KAIOKEN_LOG_LEVEL overrides", () => {
    expect(() =>
      loadCommonConfig({
        env: {
          KAIOKEN_LOG_LEVEL: "bogus",
          NODE_ENV: "production",
        },
      }),
    ).toThrow(/KAIOKEN_LOG_LEVEL/u);
  });
});

describe("data-dir helpers", () => {
  it("expands a bare home-directory override", () => {
    expect(
      resolveConfiguredDataDir({
        defaultDataDir: path.join(os.homedir(), ".kaioken"),
        env: {
          KAIOKEN_DATA_DIR: "~",
        },
        homeDir: os.homedir(),
      }),
    ).toBe(os.homedir());
  });

  it("rejects whitespace-only data dir overrides", () => {
    expect(() =>
      resolveConfiguredDataDir({
        defaultDataDir: path.join(os.homedir(), ".kaioken"),
        env: {
          KAIOKEN_DATA_DIR: " ",
        },
        homeDir: os.homedir(),
      }),
    ).toThrow("KAIOKEN_DATA_DIR must not be empty");
  });

  it("resolves development defaults from the current checkout instance", () => {
    const homeDir = "/Users/tester";
    const repoRoot = "/Users/tester/src/kaioken";

    expect(
      resolveRuntimeDataDir({
        env: {},
        homeDir,
        mode: "dev",
        repoRoot,
      }),
    ).toBe("/Users/tester/.kaioken-dev/src-kaioken-db812558aad7");
  });

  it("keeps the legacy fallback label for degenerate checkout labels", () => {
    expect(
      resolveRuntimeDataDir({
        env: {},
        homeDir: "/Users/tester",
        mode: "dev",
        repoRoot: "/Users/tester/---",
      }),
    ).toBe("/Users/tester/.kaioken-dev/worktree-41987f975862");
  });
});

describe("port helpers", () => {
  it("accepts the TCP port boundary values", () => {
    expect(
      parsePortValue({
        name: "KAIOKEN_SERVER_PORT",
        rawPort: "1",
      }),
    ).toBe(1);
    expect(
      parsePortValue({
        name: "KAIOKEN_SERVER_PORT",
        rawPort: "65535",
      }),
    ).toBe(65_535);
  });

  it("rejects malformed or out-of-range port values", () => {
    for (const rawPort of [
      "",
      " ",
      "0",
      "-1",
      "65536",
      "70000",
      "abc",
      "08",
      "4444.0",
      " 4444",
      "4444 ",
    ]) {
      expect(() =>
        parsePortValue({
          name: "KAIOKEN_SERVER_PORT",
          rawPort,
        }),
      ).toThrow("KAIOKEN_SERVER_PORT must be a valid TCP port");
    }
  });

  it("uses the default port only when the env var is unset", () => {
    expect(
      resolvePortFromEnv({
        defaultPort: 4444,
        env: {},
        name: "KAIOKEN_SERVER_PORT",
      }),
    ).toBe(4444);

    expect(() =>
      resolvePortFromEnv({
        defaultPort: 4444,
        env: {
          KAIOKEN_SERVER_PORT: "",
        },
        name: "KAIOKEN_SERVER_PORT",
      }),
    ).toThrow("KAIOKEN_SERVER_PORT must be a valid TCP port");
  });

  it("rejects whitespace-padded port env values through every port loader path", () => {
    expect(() =>
      loadServerPortConfig({
        env: {
          KAIOKEN_SERVER_PORT: " 4444",
          NODE_ENV: "development",
        },
      }),
    ).toThrow("KAIOKEN_SERVER_PORT must be a valid TCP port");

    expect(() =>
      resolvePortFromEnv({
        defaultPort: 4444,
        env: {
          KAIOKEN_SERVER_PORT: " 4444",
        },
        name: "KAIOKEN_SERVER_PORT",
      }),
    ).toThrow("KAIOKEN_SERVER_PORT must be a valid TCP port");

    expect(() =>
      loadCliConfig({
        env: createHostDaemonRuntimeEnv({
          KAIOKEN_HOST_DAEMON_PORT: " 5555",
        }),
      }),
    ).toThrow("KAIOKEN_HOST_DAEMON_PORT must be a valid TCP port");
  });
});

describe("consumer-specific config", () => {
  it("builds server config from explicit runtime env", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_APP_URL: undefined,
        KAIOKEN_APP_VERSION: undefined,
        KAIOKEN_EXTERNAL_URL: undefined,
        KAIOKEN_FF_PLACEHOLDER: undefined,
        KAIOKEN_INFERENCE: undefined,
        KAIOKEN_INFERENCE_FALLBACK: undefined,
        KAIOKEN_TRANSCRIPTION: undefined,
      }),
    });

    expect(serverConfig.KAIOKEN_SERVER_PORT).toBe(4444);
    expect(serverConfig.KAIOKEN_HOST_DAEMON_PORT).toBe(5555);
    expect(serverConfig.databasePath).toBe("/tmp/kaioken-data/kaioken.db");
    expect(serverConfig.KAIOKEN_APP_URL).toBe("");
    expect(serverConfig.KAIOKEN_APP_SURFACE).toBe("web");
    expect(serverConfig.KAIOKEN_APP_VERSION).toBe("0.0.0-dev");
    expect(serverConfig.KAIOKEN_EXTERNAL_URL).toBe("");
    expect(serverConfig.KAIOKEN_INFERENCE).toBe("codex/gpt-5.6-luna");
    expect(serverConfig.KAIOKEN_INFERENCE_FALLBACK).toBe("codex/gpt-5.4-mini");
    expect(serverConfig.KAIOKEN_TRANSCRIPTION).toBe("codex/gpt-transcribe");
    expect(serverConfig.OPENAI_API_KEY).toBe("test-openai-key");
    expect(serverConfig.featureFlags).toEqual({
      placeholder: false,
      timelineWindowEventBudget: 1_500,
    });
  });

  it("carries the launcher's server launch id only when it is set", () => {
    expect(
      loadServerConfig({
        env: createServerRuntimeEnv({ KAIOKEN_SERVER_LAUNCH_ID: undefined }),
      }),
    ).not.toHaveProperty("KAIOKEN_SERVER_LAUNCH_ID");
    expect(
      loadServerConfig({
        env: createServerRuntimeEnv({ KAIOKEN_SERVER_LAUNCH_ID: "launch-123" }),
      }).KAIOKEN_SERVER_LAUNCH_ID,
    ).toBe("launch-123");
  });

  it("defaults the server bind host to loopback", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_SERVER_BIND_HOST: undefined,
      }),
    });

    expect(serverConfig.KAIOKEN_SERVER_BIND_HOST).toBe("127.0.0.1");
  });

  it("honors an explicit wildcard server bind host", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_SERVER_BIND_HOST: "0.0.0.0",
      }),
    });

    expect(serverConfig.KAIOKEN_SERVER_BIND_HOST).toBe("0.0.0.0");
  });

  it("rejects an unsupported server bind host", () => {
    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_SERVER_BIND_HOST: "localhost",
        }),
      }),
    ).toThrow(/KAIOKEN_SERVER_BIND_HOST/u);
  });

  it("parses the placeholder feature flag from env", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_FF_PLACEHOLDER: "true",
      }),
    });

    expect(serverConfig.featureFlags.placeholder).toBe(true);
  });

  it("parses the timeline window event budget from env", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_FF_TIMELINE_WINDOW_EVENT_BUDGET: "4000",
      }),
    });

    expect(serverConfig.featureFlags.timelineWindowEventBudget).toBe(4000);
  });

  it("rejects a non-positive timeline window event budget", () => {
    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_FF_TIMELINE_WINDOW_EVENT_BUDGET: "0",
        }),
      }),
    ).toThrow(/positive integer/);
  });

  it("rejects invalid feature flag booleans in server config", () => {
    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_FF_PLACEHOLDER: "not-bool",
        }),
      }),
    ).toThrow(/KAIOKEN_FF_PLACEHOLDER/u);
  });

  it("uses 0.0.0-dev as the default KAIOKEN_APP_VERSION in production", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_APP_VERSION: undefined,
        NODE_ENV: "production",
      }),
    });

    expect(serverConfig.KAIOKEN_APP_VERSION).toBe("0.0.0-dev");
  });

  it("honors an explicit KAIOKEN_APP_VERSION env override", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_APP_VERSION: "0.1.2",
        NODE_ENV: "production",
      }),
    });

    expect(serverConfig.KAIOKEN_APP_VERSION).toBe("0.1.2");
  });

  it("parses the internal app surface marker for server telemetry", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_APP_SURFACE: "desktop",
        NODE_ENV: "production",
      }),
    });

    expect(serverConfig.KAIOKEN_APP_SURFACE).toBe("desktop");

    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_APP_SURFACE: "mobile",
          NODE_ENV: "production",
        }),
      }),
    ).toThrow("KAIOKEN_APP_SURFACE must be one of desktop, web");
  });

  it("lets tooling read the server port without validating unrelated server env", () => {
    const serverPortConfig = loadServerPortConfig({
      env: {
        KAIOKEN_EXTERNAL_URL: "not-a-url",
        KAIOKEN_SERVER_PORT: "4444",
        NODE_ENV: "development",
      },
    });

    expect(serverPortConfig.KAIOKEN_SERVER_PORT).toBe(4444);
  });

  it("validates server port env at loader call time", () => {
    expect(() =>
      loadServerPortConfig({
        env: {
          NODE_ENV: "development",
        },
      }),
    ).toThrow(/KAIOKEN_SERVER_PORT/u);
  });

  it("derives the database path from data dir without validating unrelated server env", () => {
    const databaseConfig = loadDatabaseConfig({
      env: {
        KAIOKEN_DATA_DIR: "/tmp/kaioken-data",
        KAIOKEN_EXTERNAL_URL: "not-a-url",
        NODE_ENV: "development",
      },
    });

    expect(databaseConfig.databasePath).toBe("/tmp/kaioken-data/kaioken.db");
  });

  it("requires provider/model format for KAIOKEN_INFERENCE", () => {
    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_INFERENCE: "gpt-4o-mini",
        }),
      }),
    ).toThrow(/KAIOKEN_INFERENCE/u);
  });

  it("requires provider/model format for KAIOKEN_INFERENCE_FALLBACK", () => {
    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_INFERENCE_FALLBACK: "gpt-5.4-mini",
        }),
      }),
    ).toThrow(/KAIOKEN_INFERENCE_FALLBACK/u);
  });

  it("loads an explicit inference fallback model", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_INFERENCE_FALLBACK: "anthropic/claude-haiku-4-5",
      }),
    });

    expect(serverConfig.KAIOKEN_INFERENCE_FALLBACK).toBe(
      "anthropic/claude-haiku-4-5",
    );
  });

  it("requires provider/model format for KAIOKEN_TRANSCRIPTION", () => {
    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_TRANSCRIPTION: "gpt-4o-mini-transcribe",
        }),
      }),
    ).toThrow(/KAIOKEN_TRANSCRIPTION/u);
  });

  it("requires a valid server URL for the daemon and CLI", () => {
    const env = createHostDaemonRuntimeEnv({
      KAIOKEN_SERVER_URL: "http://localhost:9999",
    });
    const hostDaemonConfig = loadHostDaemonConnectionConfig({ env });
    const cliConfig = loadCliConfig({ env });

    expect(hostDaemonConfig.KAIOKEN_SERVER_URL).toBe("http://localhost:9999");
    expect(cliConfig.KAIOKEN_SERVER_URL).toBe("http://localhost:9999");

    expect(() =>
      loadCliConfig({
        env: createHostDaemonRuntimeEnv({
          KAIOKEN_SERVER_URL: "not-a-url",
        }),
      }),
    ).toThrow(/KAIOKEN_SERVER_URL/u);
  });

  it("normalizes server URL whitespace consistently for the daemon and CLI", () => {
    const env = createHostDaemonRuntimeEnv({
      KAIOKEN_SERVER_URL: " http://localhost:9999 ",
    });
    const hostDaemonConfig = loadHostDaemonConnectionConfig({ env });
    const cliConfig = loadCliConfig({ env });

    expect(hostDaemonConfig.KAIOKEN_SERVER_URL).toBe("http://localhost:9999");
    expect(cliConfig.KAIOKEN_SERVER_URL).toBe("http://localhost:9999");

    expect(() =>
      loadCliConfig({
        env: createHostDaemonRuntimeEnv({
          KAIOKEN_SERVER_URL: "   ",
        }),
      }),
    ).toThrow("KAIOKEN_SERVER_URL must not be empty");
  });

  it("validates host-daemon connection config without requiring data dir", () => {
    const hostDaemonConfig = loadHostDaemonConnectionConfig({
      env: {
        KAIOKEN_HOST_DAEMON_PORT: "3999",
        KAIOKEN_SERVER_URL: "http://localhost:9999",
        NODE_ENV: "development",
      },
    });

    expect(hostDaemonConfig.KAIOKEN_SERVER_URL).toBe("http://localhost:9999");
    expect(hostDaemonConfig.KAIOKEN_HOST_DAEMON_PORT).toBe(3999);
  });

  it("validates explicit host-daemon ports with the shared port validator", () => {
    expect(() =>
      loadHostDaemonConnectionConfig({
        env: {
          KAIOKEN_SERVER_URL: "http://localhost:9999",
          NODE_ENV: "development",
        },
        hostDaemonPort: 0,
      }),
    ).toThrow("KAIOKEN_HOST_DAEMON_PORT must be a valid TCP port");
  });

  it("builds full host-daemon config when the daemon entrypoint owns data dir", () => {
    const hostDaemonConfig = loadHostDaemonConfig({
      env: {
        KAIOKEN_DATA_DIR: "/tmp/kaioken-data",
        KAIOKEN_HOST_DAEMON_PORT: "3999",
        KAIOKEN_SERVER_URL: "http://localhost:9999",
        NODE_ENV: "development",
      },
    });

    expect(hostDaemonConfig.KAIOKEN_DATA_DIR).toBe("/tmp/kaioken-data");
    expect(hostDaemonConfig.KAIOKEN_SERVER_URL).toBe("http://localhost:9999");
    expect(hostDaemonConfig.KAIOKEN_HOST_DAEMON_PORT).toBe(3999);
  });

  it("builds host-daemon start config from full config when data dir is not provided", () => {
    const hostDaemonStartConfig = loadHostDaemonStartConfig({
      env: {
        KAIOKEN_DATA_DIR: "/tmp/kaioken-data",
        KAIOKEN_HOST_DAEMON_PORT: "3999",
        KAIOKEN_SERVER_URL: "http://localhost:9999",
        NODE_ENV: "development",
      },
    });

    expect(hostDaemonStartConfig.dataDir).toBe("/tmp/kaioken-data");
    expect(hostDaemonStartConfig.connectionConfig.KAIOKEN_SERVER_URL).toBe(
      "http://localhost:9999",
    );
    expect(
      hostDaemonStartConfig.connectionConfig.KAIOKEN_HOST_DAEMON_PORT,
    ).toBe(3999);
  });

  it("builds logger config from an explicit data dir without resolving KAIOKEN_DATA_DIR", () => {
    const loggerConfig = loadLoggerConfig({
      dataDir: "/tmp/logger-data",
      env: {
        NODE_ENV: "development",
      },
    });

    expect(loggerConfig.KAIOKEN_DATA_DIR).toBe("/tmp/logger-data");
    expect(loggerConfig.KAIOKEN_LOG_LEVEL).toBe("debug");
  });

  it("defaults CLI connection env to the local app instance", () => {
    const cliConfig = loadCliConfig({
      env: {
        NODE_ENV: "development",
      },
    });

    expect(cliConfig.KAIOKEN_SERVER_URL).toBe("http://127.0.0.1:38886");
    expect(cliConfig.KAIOKEN_HOST_DAEMON_PORT).toBe(38887);
  });

  it("lets explicit CLI env overrides win over NODE_ENV-selected defaults", () => {
    const cliConfig = loadCliConfig({
      env: {
        KAIOKEN_HOST_DAEMON_PORT: "3999",
        KAIOKEN_SERVER_URL: "http://localhost:9999",
        NODE_ENV: "development",
      },
    });

    expect(cliConfig.KAIOKEN_SERVER_URL).toBe("http://localhost:9999");
    expect(cliConfig.KAIOKEN_HOST_DAEMON_PORT).toBe(3999);
  });

  it("allows app and external URLs to be omitted in production server config", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_APP_URL: undefined,
        KAIOKEN_EXTERNAL_URL: undefined,
        NODE_ENV: "production",
      }),
    });

    expect(serverConfig.KAIOKEN_APP_URL).toBe("");
    expect(serverConfig.KAIOKEN_EXTERNAL_URL).toBe("");
  });

  it("validates app and external URLs independently", () => {
    const serverConfig = loadServerConfig({
      env: createServerRuntimeEnv({
        KAIOKEN_APP_URL: "https://app.example.test",
        KAIOKEN_EXTERNAL_URL: "https://external.example.test",
        NODE_ENV: "production",
      }),
    });

    expect(serverConfig.KAIOKEN_APP_URL).toBe("https://app.example.test");
    expect(serverConfig.KAIOKEN_EXTERNAL_URL).toBe(
      "https://external.example.test",
    );

    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_APP_URL: "not-a-url",
          NODE_ENV: "production",
        }),
      }),
    ).toThrow(/KAIOKEN_APP_URL/u);

    expect(() =>
      loadServerConfig({
        env: createServerRuntimeEnv({
          KAIOKEN_APP_URL: "https://app.example.test",
          KAIOKEN_EXTERNAL_URL: "not-a-url",
          NODE_ENV: "production",
        }),
      }),
    ).toThrow(/KAIOKEN_EXTERNAL_URL/u);
  });

  it("reads dev app host from its dedicated config scope", () => {
    const devAppConfig = loadDevAppConfig({
      env: {
        KAIOKEN_DEV_APP_HOST: "0.0.0.0",
        NODE_ENV: "development",
      },
    });

    expect(devAppConfig.KAIOKEN_DEV_APP_HOST).toBe("0.0.0.0");
    expect(devAppConfig.KAIOKEN_DEV_APP_PORT).toBeUndefined();
  });

  it("builds app Vite dev config from the app dev entrypoint scope", () => {
    const defaultViteDevConfig = loadViteDevConfig({
      env: {
        KAIOKEN_DEV_APP_PORT: "4173",
        KAIOKEN_SERVER_PORT: "4444",
        NODE_ENV: "development",
      },
    });

    expect(defaultViteDevConfig).toEqual({
      appHost: "127.0.0.1",
      appPort: 4173,
      serverHttpOrigin: "http://127.0.0.1:4444",
      serverPort: 4444,
    });

    const explicitViteDevConfig = loadViteDevConfig({
      env: {
        KAIOKEN_DEV_APP_HOST: "0.0.0.0",
        KAIOKEN_DEV_APP_PORT: "4173",
        KAIOKEN_SERVER_PORT: "4444",
        NODE_ENV: "development",
      },
    });

    expect(explicitViteDevConfig.appHost).toBe("0.0.0.0");
  });

  it("requires the app dev port for Vite dev config", () => {
    expect(() =>
      loadViteDevConfig({
        env: {
          KAIOKEN_SERVER_PORT: "4444",
          NODE_ENV: "development",
        },
      }),
    ).toThrow("KAIOKEN_DEV_APP_PORT is required to run the app dev server");
  });

  it("parses optional host-daemon entrypoint env vars in one place", () => {
    const hostDaemonEntrypointConfig = loadHostDaemonEntrypointConfig({
      env: {
        KAIOKEN_BRIDGE_DIR: " /tmp/bridges ",
        KAIOKEN_CLI_DIR: " /tmp/kaioken-bin ",
        KAIOKEN_HOST_ENROLL_KEY: " enroll-token ",
        KAIOKEN_HOST_DAEMON_AUTO_UPDATE: "true",
        KAIOKEN_HOST_ID: " host-123 ",
        KAIOKEN_HOST_NAME: " host-123 ",
        KAIOKEN_HOST_TYPE: "persistent",
      },
    });

    expect(hostDaemonEntrypointConfig).toEqual({
      KAIOKEN_BRIDGE_DIR: "/tmp/bridges",
      KAIOKEN_CLI_DIR: "/tmp/kaioken-bin",
      KAIOKEN_HOST_ENROLL_KEY: "enroll-token",
      KAIOKEN_HOST_DAEMON_AUTO_UPDATE: true,
      KAIOKEN_HOST_ID: "host-123",
      KAIOKEN_HOST_NAME: "host-123",
      KAIOKEN_HOST_TYPE: "persistent",
    });
  });

  it("drops empty optional host-daemon entrypoint env vars", () => {
    const hostDaemonEntrypointConfig = loadHostDaemonEntrypointConfig({
      env: {
        KAIOKEN_BRIDGE_DIR: "",
        KAIOKEN_CLI_DIR: "   ",
        KAIOKEN_HOST_ENROLL_KEY: " ",
        KAIOKEN_HOST_NAME: "",
        KAIOKEN_HOST_TYPE: "",
      },
    });

    expect(hostDaemonEntrypointConfig).toEqual({});
  });

  it("rejects invalid host-daemon entrypoint host types", () => {
    expect(() =>
      loadHostDaemonEntrypointConfig({
        env: {
          KAIOKEN_HOST_TYPE: "ephemeral",
        },
      }),
    ).toThrow('Invalid KAIOKEN_HOST_TYPE "ephemeral"');
  });
});

describe("provider model config", () => {
  it("parses provider/model values", () => {
    expect(
      parseProviderModelConfig({
        name: "KAIOKEN_INFERENCE",
        value: "codex/gpt-5.4-mini",
      }),
    ).toEqual({
      provider: "codex",
      modelId: "gpt-5.4-mini",
    });
  });

  it("rejects empty or nested provider/model values", () => {
    for (const value of ["gpt-4o-mini", "/gpt-4o-mini", "openai/", "a/b/c"]) {
      expect(() =>
        parseProviderModelConfig({
          name: "KAIOKEN_INFERENCE",
          value,
        }),
      ).toThrow(/KAIOKEN_INFERENCE/u);
    }
  });
});
