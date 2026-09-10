import {
  defineWorkspaceTestConfig,
  sharedWorkerProjects,
} from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    projects: sharedWorkerProjects({
      pkgDir: __dirname,
      name: "kaioken-plugin-provider-pi",
      include: ["*.test.ts", "*.test.tsx", "src/**/*.test.ts"],
    }),
  },
});
