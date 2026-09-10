import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  test: {
    silent: "passed-only",
    name: "kaioken-plugin-push-notifications",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
