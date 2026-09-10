import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    env: {
      KAIOKEN_SERVER_URL: "http://127.0.0.1:49161",
      KAIOKEN_HOST_DAEMON_PORT: "49162",
    },
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@kaioken/cli",
      include: ["src/**/*.test.ts"],
    }),
  },
});
