import { describe, expect, it } from "vitest";
import {
  mcpServerDisableOverrides,
  parseConfiguredMcpServerNames,
} from "./mcp-servers.js";

describe("parseConfiguredMcpServerNames", () => {
  it("reads bare, quoted, and nested table headers once each", () => {
    const names = parseConfiguredMcpServerNames(`
model = "gpt-5"

[mcp_servers.playwright]
command = "npx"

[mcp_servers.sonic_browser.env]
ELECTRON_RUN_AS_NODE = "1"

[mcp_servers."computer-use"]
enabled = false

[ mcp_servers . 'docs' ]
url = "https://example.com/mcp"

[mcp_servers.playwright.env]
FOO = "bar"

[projects."/tmp/x"]
trust_level = "trusted"
`);
    expect(names).toEqual([
      "playwright",
      "sonic_browser",
      "computer-use",
      "docs",
    ]);
  });

  it("returns nothing for configs without MCP servers", () => {
    expect(parseConfiguredMcpServerNames("")).toEqual([]);
    expect(parseConfiguredMcpServerNames("[mcp_serversx.a]\nb = 1\n")).toEqual(
      [],
    );
  });
});

describe("mcpServerDisableOverrides", () => {
  it("uses unquoted CLI key segments so Codex disables existing servers", () => {
    expect(mcpServerDisableOverrides(["node_repl", "computer-use"])).toEqual([
      "-c",
      "mcp_servers.node_repl.enabled=false",
      "-c",
      "mcp_servers.computer-use.enabled=false",
    ]);
  });
});
