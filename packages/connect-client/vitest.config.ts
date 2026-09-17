import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: [
      ...sharedWorkerProjects({
        pkgDir: import.meta.dirname,
        name: "connect-client",
        include: ["test/**/*.test.ts"],
        exclude: ["dist/**", "node_modules/**", "test/account-events.test.ts"],
      }),
      {
        extends: true,
        test: {
          name: "connect-client:timers",
          include: ["test/account-events.test.ts"],
          isolate: true,
        },
      },
    ],
  },
});
