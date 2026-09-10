import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    env: {
      KAIOKEN_DATA_DIR: "/tmp/kaioken-server-test",
      KAIOKEN_SERVER_PORT: "49161",
      KAIOKEN_HOST_DAEMON_PORT: "49162",
    },
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@kaioken/server",
      include: ["src/**/*.test.ts", "test/**/*.test.ts"],
    }),
  },
});
