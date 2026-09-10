import { defineWorkspaceTestConfig } from "../../vitest.shared.js";
export default defineWorkspaceTestConfig({
  test: {
    name: "kaioken-plugin-browser-automation",
    include: ["**/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
