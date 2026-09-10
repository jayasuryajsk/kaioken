import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "@kaioken/scripts",
      include: ["test/**/*.test.ts", "test/**/*.test.mjs"],
    }),
  },
});
