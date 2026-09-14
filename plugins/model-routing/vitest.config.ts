import { fileURLToPath } from "node:url";
import { defineWorkspaceTestConfig } from "../../vitest.shared.js";

export default defineWorkspaceTestConfig({
  resolve: {
    alias: {
      "@/": fileURLToPath(new URL("./", import.meta.url)),
    },
  },
  test: {
    name: "kaioken-plugin-model-routing",
    include: ["*.test.ts", "*.test.tsx", "lib/*.test.ts"],
    exclude: ["dist/**", "node_modules/**"],
  },
});
