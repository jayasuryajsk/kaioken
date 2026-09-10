import { describe, expect, it } from "vitest";
import { threadScope } from "../src/thread-event-scope.js";
import type { ThreadEvent } from "../src/provider-event.js";
import {
  KAIOKEN_THREAD_NAME_TAG,
  fromProviderExternalThreadName,
  normalizeProviderThreadNameEvent,
  tagThreadName,
  toProviderExternalThreadName,
} from "../src/thread-name-tags.js";

describe("thread name tags", () => {
  it("round-trips user-provided literal kaioken-prefixed titles", () => {
    const providerName = toProviderExternalThreadName("[kaioken] Literal");

    expect(providerName).toBe("[kaioken] [kaioken] Literal");
    expect(fromProviderExternalThreadName(providerName)).toBe("[kaioken] Literal");
  });

  it("normalizes provider title events by stripping one kaioken tag", () => {
    const event = {
      type: "thread/name/updated",
      threadId: "t1",
      providerThreadId: "p1",
      scope: threadScope(),
      threadName: tagThreadName({
        name: "[kaioken] Literal",
        tag: KAIOKEN_THREAD_NAME_TAG,
      }),
    } satisfies ThreadEvent;

    expect(normalizeProviderThreadNameEvent(event)).toEqual({
      ...event,
      threadName: "[kaioken] Literal",
    });
  });
});
