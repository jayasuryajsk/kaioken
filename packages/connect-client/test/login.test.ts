import { expect, it, vi } from "vitest";
import { connectLoginRequest, connectLoginStartSchema } from "../src/login.js";

it("explains unavailable and old relays without leaking fetch internals", async () => {
  const offline = vi
    .fn<typeof fetch>()
    .mockRejectedValue(new TypeError("fetch failed"));
  await expect(
    connectLoginRequest(
      "https://kaioken.app",
      "/api/connect/login",
      connectLoginStartSchema,
      {},
      undefined,
      offline,
    ),
  ).rejects.toThrow("Could not reach the Kaioken sign-in service");
  const oldRelay = vi
    .fn<typeof fetch>()
    .mockResolvedValue(new Response("Not found", { status: 404 }));
  await expect(
    connectLoginRequest(
      "https://kaioken.app",
      "/api/connect/login",
      connectLoginStartSchema,
      {},
      undefined,
      oldRelay,
    ),
  ).rejects.toThrow("does not support GitHub sign-in yet");
});

it("preserves actionable service errors and rejects malformed success payloads", async () => {
  const unavailable = vi
    .fn<typeof fetch>()
    .mockResolvedValue(
      Response.json(
        { error: "GitHub sign-in is not configured on this relay yet." },
        { status: 503 },
      ),
    );
  await expect(
    connectLoginRequest(
      "https://kaioken.app",
      "/api/connect/login",
      connectLoginStartSchema,
      {},
      undefined,
      unavailable,
    ),
  ).rejects.toThrow("not configured");
  const malformed = vi
    .fn<typeof fetch>()
    .mockResolvedValue(Response.json({ id: "bad" }));
  await expect(
    connectLoginRequest(
      "https://kaioken.app",
      "/api/connect/login",
      connectLoginStartSchema,
      {},
      undefined,
      malformed,
    ),
  ).rejects.toThrow();
});
