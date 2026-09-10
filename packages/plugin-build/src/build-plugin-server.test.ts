import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildPluginServer,
  PLUGIN_SERVER_EXTERNALS,
} from "./build-plugin-server.js";
import { resolvePluginBuildToolchain } from "./toolchain.js";

function testToolchain() {
  return resolvePluginBuildToolchain(join(tmpdir(), "kaioken-toolchain-unused"));
}

describe("plugin server build", () => {
  const tempDirs: string[] = [];

  afterEach(async () => {
    await Promise.all(
      tempDirs
        .splice(0)
        .map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  it("keeps both the current and the pre-rename SDK specifier external", () => {
    expect(PLUGIN_SERVER_EXTERNALS).toContain("@get-kaioken/plugin-sdk");
    expect(PLUGIN_SERVER_EXTERNALS).toContain("@get-bb/plugin-sdk");
  });

  it("builds a pre-rename source importing bare @get-bb/plugin-sdk", async () => {
    const dir = await mkdtemp(join(tmpdir(), "kaioken-plugin-server-legacy-"));
    tempDirs.push(dir);
    await mkdir(join(dir, "dist"), { recursive: true });
    await writeFile(
      join(dir, "package.json"),
      JSON.stringify({
        name: "kaioken-plugin-legacy-sdk-fixture",
        version: "0.0.0",
        bb: {
          name: "Legacy SDK fixture",
          description: "Verifies the pre-rename SDK specifier stays external.",
          branding: { icon: "Zap" },
          server: "./server.ts",
        },
      }),
    );
    await writeFile(
      join(dir, "server.ts"),
      [
        'import type { KaiokenPluginApi } from "@get-bb/plugin-sdk";',
        'import { defineRpcContract } from "@get-bb/plugin-sdk";',
        "export default function plugin(bb: KaiokenPluginApi) {",
        "  void defineRpcContract;",
        "  void bb;",
        "}",
        "",
      ].join("\n"),
    );

    const { jsPath } = await buildPluginServer(
      dir,
      "0.0.0-test",
      await testToolchain(),
    );

    const bundle = await readFile(jsPath, "utf8");
    expect(bundle).toContain('from "@get-bb/plugin-sdk"');
  });

  describe("SDK subpath imports", () => {
    const manifest = {
      name: "kaioken-plugin-server-subpath-fixture",
      version: "1.0.0",
      engines: { bb: ">=0.0" },
      bb: {
        name: "Server subpath fixture",
        description: "Imports a host contract from the SDK in server code.",
        branding: { icon: "Cpu" },
        server: "./server.ts",
      },
    };
    const serverSource = [
      'import { defineRpcContract, type KaiokenPluginApi } from "@get-kaioken/plugin-sdk";',
      'import { experimental_nativeRootsHostContract } from "@get-kaioken/plugin-sdk/host";',
      "export const contract = defineRpcContract(experimental_nativeRootsHostContract);",
      "export default function plugin(bb: KaiokenPluginApi) {",
      "  void bb;",
      "}",
      "",
    ].join("\n");

    async function writeFixture(dir: string): Promise<void> {
      await writeFile(join(dir, "package.json"), JSON.stringify(manifest));
      await writeFile(join(dir, "server.ts"), serverSource);
    }

    it("keeps the bare specifier external and bundles the subpath from the plugin's SDK", async () => {
      const dir = await mkdtemp(join(tmpdir(), "kaioken-plugin-server-subpath-"));
      tempDirs.push(dir);
      await writeFixture(dir);
      await mkdir(join(dir, "node_modules", "@get-kaioken"), { recursive: true });
      await symlink(
        resolve(import.meta.dirname, "../../plugin-sdk"),
        join(dir, "node_modules", "@get-kaioken", "plugin-sdk"),
        "dir",
      );

      const { jsPath } = await buildPluginServer(
        dir,
        "0.0.0-test",
        await testToolchain(),
      );

      const bundle = await readFile(jsPath, "utf8");
      expect(bundle).toContain('from "@get-kaioken/plugin-sdk"');
      expect(bundle).not.toContain('"@get-kaioken/plugin-sdk/host"');
      expect(bundle).toContain("resolveNativeRoots");
    });

    it("names the missing SDK dependency when the plugin has no node_modules", async () => {
      const dir = await mkdtemp(join(tmpdir(), "kaioken-plugin-server-no-sdk-"));
      tempDirs.push(dir);
      await writeFixture(dir);

      await expect(
        buildPluginServer(dir, "0.0.0-test", await testToolchain()),
      ).rejects.toThrow(
        '"@get-kaioken/plugin-sdk/host" is not installed for this plugin (no node_modules/@get-kaioken/plugin-sdk); a server entry\'s "@get-kaioken/plugin-sdk/host" import is bundled from the plugin\'s own SDK install (kaioken serves only the bare "@get-kaioken/plugin-sdk" at load time), so the plugin needs the SDK as a dependency',
      );
    });

    it("names the unbuilt SDK dist when the package is installed without it", async () => {
      const dir = await mkdtemp(
        join(tmpdir(), "kaioken-plugin-server-unbuilt-sdk-"),
      );
      tempDirs.push(dir);
      await writeFixture(dir);
      const sdkDir = join(dir, "node_modules", "@get-kaioken", "plugin-sdk");
      await mkdir(sdkDir, { recursive: true });
      await writeFile(
        join(sdkDir, "package.json"),
        JSON.stringify({
          name: "@get-kaioken/plugin-sdk",
          version: "0.0.0-test",
          type: "module",
          exports: {
            ".": { import: "./dist/index.js", default: "./dist/index.js" },
            "./host": { import: "./dist/host.js", default: "./dist/host.js" },
          },
        }),
      );

      await expect(
        buildPluginServer(dir, "0.0.0-test", await testToolchain()),
      ).rejects.toThrow(
        `"@get-kaioken/plugin-sdk/host" is installed for this plugin but its dist is not built: run the SDK build (${join(await realpath(sdkDir), "dist", "host.js")} is missing)`,
      );
    });
  });
});
