import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { getThread } from "@kaioken/db";
import {
  insertHandoff,
  updateHandoff,
  assertNoThreadMutationInFlight,
  withThreadHandoffMutationGuard,
} from "../../src/services/connections/handoff-store.js";
import { withTestHarness } from "../helpers/test-app.js";
import { seedThreadFixture } from "../helpers/seed.js";

it("rejects source task mutations through every public action while allowing reads and cancellation recovery", async () => {
  await withTestHarness(async (harness) => {
    const { thread } = seedThreadFixture(harness);
    const id = randomUUID();
    insertHandoff(harness.db, {
      id,
      role: "source",
      phase: "exported",
      sourceThreadId: thread.id,
      targetThreadId: null,
      payload: "{}",
      error: null,
    });
    for (const [method, suffix] of [
      ["PATCH", ""],
      ["DELETE", ""],
      ["POST", "/edit-message"],
      ["POST", "/context/clear"],
      ["POST", "/queued-messages"],
      ["PATCH", "/queued-messages/message"],
      ["POST", "/archive"],
      ["POST", "/unarchive"],
      ["POST", "/send"],
      ["POST", "/goal/clear"],
    ]) {
      const response = await harness.app.request(
        `/api/v1/threads/${thread.id}${suffix}`,
        { method, headers: { "content-type": "application/json" }, body: "{}" },
      );
      expect(response.status, `${method} ${suffix}`).toBe(409);
      expect(await response.json()).toMatchObject({
        code: "thread_handoff_in_progress",
      });
    }
    expect(getThread(harness.db, thread.id)).toEqual(thread);
    expect(
      (await harness.app.request(`/api/v1/threads/${thread.id}`)).status,
    ).toBe(200);
    updateHandoff(harness.db, id, "source", { phase: "cancelled" });
    const updated = await harness.app.request(`/api/v1/threads/${thread.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "Recovered task" }),
    });
    expect(updated.status).toBe(200);
    expect(getThread(harness.db, thread.id)?.title).toBe("Recovered task");
  });
});

it("refuses to begin a snapshot while an earlier asynchronous mutation is in flight", async () => {
  await withTestHarness(async (harness) => {
    const { thread } = seedThreadFixture(harness);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const work = withThreadHandoffMutationGuard(
      harness.db,
      thread.id,
      () => pending,
    );
    expect(() => assertNoThreadMutationInFlight(harness.db, thread.id)).toThrow(
      /processing another change/,
    );
    finish();
    await work;
    expect(() =>
      assertNoThreadMutationInFlight(harness.db, thread.id),
    ).not.toThrow();
    await expect(
      withThreadHandoffMutationGuard(harness.db, thread.id, async () => {
        throw new Error("failed mutation");
      }),
    ).rejects.toThrow("failed mutation");
    expect(() =>
      assertNoThreadMutationInFlight(harness.db, thread.id),
    ).not.toThrow();
  });
});
