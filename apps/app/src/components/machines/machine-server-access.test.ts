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
  it("passes the method's own message through", () => {
    expect(machineServerAccessBlockedReason(CONNECT_UNPAIRED)).toBe(
      "Pair this bb instance with bb connect",
    );
  });

  it("asks for an address when the direct method has none", () => {
    expect(machineServerAccessBlockedReason(MANUAL_WITHOUT_URL)).toBe(
      "Set the address machines should use to reach this server.",
    );
  });

  it("names the unreachable address when one is saved", () => {
    expect(
      machineServerAccessBlockedReason({
        ...MANUAL_WITH_URL,
        effectiveUrl: "http://localhost:3000",
      }),
    ).toBe(
      "Machines cannot reach http://localhost:3000. Use an address other than localhost.",
    );
  });

  it("says nothing once access is ready", () => {
    expect(machineServerAccessBlockedReason(CONNECT_PAIRED)).toBeNull();
  });
});
