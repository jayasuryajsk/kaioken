import { defineConfig } from "vitest/config";
import { sharedWorkerProjects } from "../../vitest.shared";

export default defineConfig({
  test: {
    environment: "node",
    projects: sharedWorkerProjects({
      pkgDir: import.meta.dirname,
      name: "relay",
      include: ["src/**/*.test.ts"],
    }),
  },
});
