import { expect, it } from "vitest";
import { readModalMachineResource } from "./lifecycle.js";

it("drops obsolete expiration metadata while retaining current snapshot recovery state", () => {
  const resource = {
    version: 5,
    key: "existing",
    sandboxId: null,
    snapshotImageId: "saved",
    snapshotSandboxId: "previous-sandbox",
    pendingSnapshotImageIds: ["older-snapshot"],
    imageId: "base-image",
    accountIdentity: "account",
    appName: "app",
    cpu: 2,
    memoryMiB: 8192,
  };
  expect(readModalMachineResource({ ...resource, expiresAt: 123 })).toEqual(
    resource,
  );
  expect(readModalMachineResource(resource)).toEqual(resource);
  for (const version of [3, 4]) {
    expect(() => readModalMachineResource({ ...resource, version })).toThrow();
  }
  expect(() =>
    readModalMachineResource({ ...resource, accountIdentity: "" }),
  ).toThrow();
});
