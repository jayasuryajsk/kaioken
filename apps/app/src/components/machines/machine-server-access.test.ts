import { describe, expect, it } from "vitest";
import {
  machineServerAccessBlockedReason,
  machineServerAccessReady,
} from "./machine-server-access";
import type { ServerAccessStatus } from "@bb/server-contract";

const provider = {
  id: "relay",
  displayName: "Relay",
  description: "Use a managed relay.",
  pluginId: "relay-plugin",
} as const;
const direct = {
  id: "direct",
  displayName: "Manual",
  description: "Use your own domain or network address.",
  pluginId: null,
} as const;

function status(
  availability: ServerAccessStatus["providers"][number]["availability"],
  overrides: Partial<ServerAccessStatus> = {},
): ServerAccessStatus {
  return {
    providers: [
      { ...provider, availability },
      { ...direct, availability },
    ],
    defaultProviderId: provider.id,
    effectiveUrl: null,
    urlSource: null,
    ...overrides,
  };
}

const PROVIDER_READY = status({ status: "available" });
const PROVIDER_UNAVAILABLE = status({
  status: "unavailable",
  message: "Relay unavailable",
});
const PROVIDER_SETUP_REQUIRED = status({
  status: "setup-required",
  message: "Set up the relay",
});
const DIRECT_WITH_URL = status(
  { status: "available" },
  {
    providers: [
      { ...provider, availability: { status: "available" } },
      { ...direct, availability: { status: "available" } },
    ],
    defaultProviderId: "direct",
    effectiveUrl: "https://bb.example.com",
    urlSource: "setting",
  },
);
const DIRECT_WITHOUT_URL = {
  ...DIRECT_WITH_URL,
  effectiveUrl: null,
  urlSource: null,
};
const METHOD_NOT_INSTALLED = {
  ...PROVIDER_READY,
  providers: [PROVIDER_READY.providers[1]!],
  defaultProviderId: "missing",
};

describe("machineServerAccessReady", () => {
  it.each([
    ["provider available", PROVIDER_READY, true],
    ["provider setup required", PROVIDER_SETUP_REQUIRED, false],
    ["provider unavailable", PROVIDER_UNAVAILABLE, false],
    ["direct with a reachable url", DIRECT_WITH_URL, true],
    ["direct without a url", DIRECT_WITHOUT_URL, false],
    ["a method that is not installed", METHOD_NOT_INSTALLED, false],
  ] as const)("reports %s", (_label, access, ready) => {
    expect(machineServerAccessReady(access)).toBe(ready);
  });

  it("treats an unloaded config as not ready", () => {
    expect(machineServerAccessReady(undefined)).toBe(false);
  });

  it("refuses a loopback address machines cannot reach", () => {
    expect(
      machineServerAccessReady({
        ...DIRECT_WITH_URL,
        effectiveUrl: "http://localhost:3000",
      }),
    ).toBe(false);
  });
});

describe("machineServerAccessBlockedReason", () => {
  it.each([
    ["a method that was never set up", PROVIDER_SETUP_REQUIRED],
    ["a method that is refusing this bb", PROVIDER_UNAVAILABLE],
    ["a direct method with no address", DIRECT_WITHOUT_URL],
    ["a method that is not installed", METHOD_NOT_INSTALLED],
  ] as const)("asks for configuration for %s", (_label, access) => {
    expect(machineServerAccessBlockedReason(access)).toBe(
      "Configure how machines should connect to this bb server.",
    );
  });

  it("says nothing once access is ready", () => {
    expect(machineServerAccessBlockedReason(PROVIDER_READY)).toBeNull();
    expect(machineServerAccessBlockedReason(DIRECT_WITH_URL)).toBeNull();
  });
});
