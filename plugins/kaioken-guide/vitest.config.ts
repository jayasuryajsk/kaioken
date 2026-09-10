import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "kaioken-plugin-kaioken-guide",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**"],
  },
});
