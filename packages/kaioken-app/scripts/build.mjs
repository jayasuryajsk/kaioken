import { access } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  buildNodeEsmEntry,
  copyDirectory,
} from "../../../scripts/build-utils.mjs";

const execFileAsync = promisify(execFile);
const scriptsDir = dirname(fileURLToPath(import.meta.url));
const packageRoot = resolve(scriptsDir, "..");
const workspaceRoot = resolve(packageRoot, "..", "..");

async function assertPathExists(pathToCheck, label) {
  try {
    await access(pathToCheck);
  } catch {
    throw new Error(
      `Missing ${label} at ${pathToCheck}. Build @kaioken/app, @kaioken/server, and @kaioken/host-daemon before packaging kaioken-app.`,
    );
  }
}

async function copyBuildOutput({ from, label, to }) {
  await assertPathExists(from, label);
  await copyDirectory({ from, to });
}

async function buildPublicSdkDeclarations() {
  await execFileAsync(
    "node",
    [resolve(scriptsDir, "build-public-sdk-dts.mjs")],
    { cwd: packageRoot },
  );
}

const entrypoints = [
  ["kaioken-app", "kaioken-app.js"],
  ["kaioken", "kaioken.js"],
  ["kaioken-server", "kaioken-server.js"],
  ["kaioken-host-daemon", "kaioken-host-daemon.js"],
];

for (const [sourceName, outputName] of entrypoints) {
  await buildNodeEsmEntry({
    cleanDist: sourceName === "kaioken-app",
    entryPoint: resolve(packageRoot, "src", "bin", `${sourceName}.ts`),
    executable: true,
    outfile: resolve(packageRoot, "dist", outputName),
    packageRoot,
  });
}

await buildNodeEsmEntry({
  cleanDist: false,
  entryPoint: resolve(packageRoot, "src", "public-sdk.ts"),
  outfile: resolve(packageRoot, "dist", "index.js"),
  packageRoot,
});
await buildPublicSdkDeclarations();
await buildNodeEsmEntry({
  cleanDist: false,
  entryPoint: resolve(scriptsDir, "prune-kaioken-chunks.mjs"),
  outfile: resolve(packageRoot, "dist", "prune-kaioken-chunks.mjs"),
  packageRoot,
});

await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "app", "dist"),
  label: "@kaioken/app dist",
  to: resolve(packageRoot, "app", "dist"),
});
await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "server", "dist"),
  label: "@kaioken/server dist",
  to: resolve(packageRoot, "server", "dist"),
});
// Builtin plugins are bundled at packaging time (not in @kaioken/server's build,
// which source checkouts don't need — the registry falls back to the repo's
// plugins/<name> there). Runs in apps/server so tsx + workspace imports
// resolve; writes straight into the packaged server dist.
await execFileAsync(
  "node",
  [
    "--conditions=source",
    "--import",
    "tsx",
    resolve(
      workspaceRoot,
      "apps",
      "server",
      "scripts",
      "copy-builtin-plugins.ts",
    ),
    "--target",
    resolve(packageRoot, "server", "dist", "builtin-plugins"),
  ],
  { cwd: resolve(workspaceRoot, "apps", "server") },
);
await copyBuildOutput({
  from: resolve(workspaceRoot, "apps", "host-daemon", "dist"),
  label: "@kaioken/host-daemon dist",
  to: resolve(packageRoot, "host-daemon", "dist"),
});
// The kaioken CLI is code-split into host-daemon/dist/kaioken-chunks. A turbo cache hit
// restores apps/host-daemon/dist without clearing it first, so the copy can
// carry an earlier build's hashed chunks; ship only the ones `kaioken` reaches.
await assertPathExists(
  resolve(packageRoot, "host-daemon", "dist", "kaioken-chunks"),
  "bundled kaioken CLI chunks",
);
const pruneRun = await execFileAsync(
  "node",
  [resolve(packageRoot, "dist", "prune-kaioken-chunks.mjs")],
  { cwd: packageRoot },
);
process.stderr.write(pruneRun.stderr);

process.stdout.write("kaioken-app: built package assets\n");
