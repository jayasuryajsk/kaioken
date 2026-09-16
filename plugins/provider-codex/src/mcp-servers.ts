import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveCodexHome } from "./codex-home.js";

const TABLE_HEADER_PATTERN =
  /^\s*\[\s*mcp_servers\s*\.\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|([A-Za-z0-9_-]+))\s*(?:\.[^\]]*)?\]/u;

export function parseConfiguredMcpServerNames(configToml: string): string[] {
  const names: string[] = [];
  const seen = new Set<string>();
  for (const line of configToml.split(/\r?\n/u)) {
    const match = TABLE_HEADER_PATTERN.exec(line);
    if (match === null) continue;
    const name = match[1] ?? match[2] ?? match[3];
    if (name === undefined || name.length === 0 || seen.has(name)) continue;
    seen.add(name);
    names.push(name);
  }
  return names;
}

export function readConfiguredMcpServerNames(
  env: Readonly<Record<string, string | undefined>> = process.env,
): string[] {
  try {
    return parseConfiguredMcpServerNames(
      fs.readFileSync(
        path.join(resolveCodexHome(os.homedir(), env), "config.toml"),
        "utf8",
      ),
    );
  } catch {
    return [];
  }
}

export function mcpServerDisableOverrides(names: readonly string[]): string[] {
  return names.flatMap((name) => [
    "-c",
    `mcp_servers.${name}.enabled=false`,
  ]);
}
