import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

const parsedTimeoutScale = Number(process.env.KAIOKEN_TEST_TIMEOUT_SCALE ?? 1);
const timeoutScale =
  Number.isFinite(parsedTimeoutScale) && parsedTimeoutScale > 0
    ? parsedTimeoutScale
    : 1;

export default defineWorkspaceTestConfig({
  test: {
    hookTimeout: Math.ceil(60_000 * timeoutScale),
    env: {
      KAIOKEN_DATA_DIR: "/tmp/kaioken-integration-test",
      KAIOKEN_SERVER_PORT: "49161",
      KAIOKEN_SERVER_URL: "http://127.0.0.1:49161",
      KAIOKEN_HOST_DAEMON_PORT: "49162",
    },
    silent: "passed-only",
    testTimeout: Math.ceil(60_000 * timeoutScale),
    projects: [
      {
        extends: true,
        test: {
          name: "@kaioken/integration-tests",
          fileParallelism: true,
          isolate: false,
          globalSetup: ["./global-setup.ts"],
          include: ["fake/**/*.test.ts"],
        },
      },
      {
        extends: true,
        test: {
          name: "@kaioken/integration-tests:native-roots-golden",
          include: ["native-roots-golden/**/*.test.ts"],
        },
      },
    ],
  },
});
