import { describe, expect, it } from "vitest";
import {
  machineServerAccessBlockedReason,
  machineServerAccessReady,
} from "./machine-server-access";
import {
  CONNECT_PAIRED,
  CONNECT_PAIRED_WITHOUT_URL,
  CONNECT_UNAVAILABLE,
  CONNECT_UNPAIRED,
  MANUAL_WITH_URL,
  MANUAL_WITHOUT_URL,
  METHOD_NOT_INSTALLED,
} from "../../../.ladle/machine-story-fixtures";

describe("machineServerAccessReady", () => {
  it.each([
    ["bb connect paired", CONNECT_PAIRED, true],
    ["bb connect paired without a url", CONNECT_PAIRED_WITHOUT_URL, true],
    ["bb connect unpaired", CONNECT_UNPAIRED, false],
    ["bb connect refused", CONNECT_UNAVAILABLE, false],
    ["direct with a reachable url", MANUAL_WITH_URL, true],
    ["direct without a url", MANUAL_WITHOUT_URL, false],
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
        ...MANUAL_WITH_URL,
        effectiveUrl: "http://localhost:3000",
      }),
    ).toBe(false);
  });
});

describe("machineServerAccessBlockedReason", () => {
  it.each([
    ["a method that was never set up", CONNECT_UNPAIRED],
    ["a direct method with no address", MANUAL_WITHOUT_URL],
    ["a method that is not installed", METHOD_NOT_INSTALLED],
  ] as const)("asks for configuration for %s", (_label, access) => {
    expect(machineServerAccessBlockedReason(access)).toBe(
      "Configure how machines should connect to this bb server.",
    );
  });

  it("reports a configured method that is failing in its own words", () => {
    expect(machineServerAccessBlockedReason(CONNECT_UNAVAILABLE)).toBe(
      "The gate rejected this bb's credential (HTTP 401)",
    );
  });

  it("names the unreachable address when one is saved", () => {
    expect(
      machineServerAccessBlockedReason({
        ...MANUAL_WITH_URL,
        effectiveUrl: "http://localhost:3000",
      }),
    ).toBe(
      "Machines cannot reach http://localhost:3000. Give them an address other than localhost.",
    );
  });

  it("says nothing once access is ready", () => {
    expect(machineServerAccessBlockedReason(CONNECT_PAIRED)).toBeNull();
  });
});
