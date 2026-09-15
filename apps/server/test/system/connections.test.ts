import { describe, expect, it } from "vitest";
import {
  connectionSelfSchema,
  CONNECTION_IDENTITY_HEADER,
} from "@kaioken/server-contract";
import { withTestHarness } from "../helpers/test-app.js";
import { getServerIdentity } from "../../src/services/connections/server-identity.js";

describe("connection identity", () => {
  it("persists an installation identity independently of its host and public URL", async () => {
    await withTestHarness(async (harness) => {
      const response = await harness.app.request("/api/v1/connections/self");
      expect(response.status).toBe(200);
      const identity = connectionSelfSchema.parse(await response.json());
      expect(identity.workspaceProtocol).toBe(1);
      expect(getServerIdentity(harness.db)).toBe(identity.serverId);
      const matching = await harness.app.request("/api/v1/connections/self", {
        headers: { [CONNECTION_IDENTITY_HEADER]: identity.serverId },
      });
      expect(matching.status).toBe(200);
      const wrong = await harness.app.request("/api/v1/threads", {
        method: "POST",
        headers: {
          [CONNECTION_IDENTITY_HEADER]: "ab2d59e2-2f77-4272-9242-a3351d2ef44b",
          "content-type": "application/json",
        },
        body: "{}",
      });
      expect(wrong.status).toBe(409);
      expect(await wrong.json()).toMatchObject({
        code: "connection_identity_changed",
      });
    });
  });
});
