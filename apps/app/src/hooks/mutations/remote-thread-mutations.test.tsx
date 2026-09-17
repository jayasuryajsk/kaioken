// @vitest-environment jsdom

import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FederatedServer } from "@kaioken/client-core";
import { resetRemoteSdkForTest } from "@/lib/federation/remote-sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  remoteThreadQueryKey,
  remoteTimelineQueryKey,
} from "../queries/remote-thread-queries";
import {
  useSendRemoteThreadMessage,
  useStopRemoteThread,
} from "./remote-thread-mutations";

import { describeRemoteWriteFailure } from "@/lib/federation/remote-write-errors";

const toast = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock("@/components/ui/app-toast", () => ({
  appToast: { error: toast.error },
}));

const MINI: FederatedServer = {
  handle: "mini",
  name: "Mac mini",
  url: "https://mini.kaioken.app",
  live: true,
  lastSeenAt: 1,
  home: false,
};

const fetchMock = vi.fn<typeof fetch>();

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  resetRemoteSdkForTest();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  toast.error.mockReset();
});

describe("useSendRemoteThreadMessage", () => {
  it("posts the reply to the remote server and refreshes that server's thread queries", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ ok: true, delivery: "sent" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const { wrapper, queryClient } = createQueryClientTestHarness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useSendRemoteThreadMessage(MINI), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync({
        threadId: "thr_mini",
        input: [{ type: "text", text: "go on", mentions: [] }],
        mode: "queue-if-active",
      });
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    const request = new Request(url, init);
    expect(request.url).toBe(
      "https://mini.kaioken.app/api/v1/threads/thr_mini/send",
    );
    expect(request.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(await request.json()).toMatchObject({
      mode: "queue-if-active",
      input: [{ type: "text", text: "go on" }],
    });
    const invalidatedKeys = invalidate.mock.calls.map(
      ([filters]) => filters?.queryKey,
    );
    expect(invalidatedKeys).toContainEqual(
      remoteThreadQueryKey("mini", "thr_mini"),
    );
    expect(invalidatedKeys).toContainEqual(
      remoteTimelineQueryKey("mini", "thr_mini"),
    );
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("names the server in a toast when it answers 503 and leaves local queries alone", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "offline" }), {
        status: 503,
        headers: { "content-type": "application/json" },
      }),
    );
    const { wrapper, queryClient } = createQueryClientTestHarness();
    queryClient.setQueryData(["threads", "list"], { local: true });
    const { result } = renderHook(() => useSendRemoteThreadMessage(MINI), {
      wrapper,
    });
    await act(async () => {
      await result.current
        .mutateAsync({
          threadId: "thr_mini",
          input: [{ type: "text", text: "go on", mentions: [] }],
          mode: "queue-if-active",
        })
        .catch(() => undefined);
    });
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0]![0]).toBe(
      "Mac mini is unavailable. Refresh its status before retrying the reply.",
    );
    expect(queryClient.getQueryData(["threads", "list"])).toEqual({
      local: true,
    });
  });
});

describe("useStopRemoteThread", () => {
  it("stops on the remote server and reports a 401 as a sign-in problem", async () => {
    fetchMock.mockResolvedValue(
      new Response(JSON.stringify({ error: "unauthorized" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useStopRemoteThread(MINI), {
      wrapper,
    });
    await act(async () => {
      await result.current.mutateAsync("thr_mini").catch(() => undefined);
    });
    expect(new Request(...fetchMock.mock.calls[0]!).url).toBe(
      "https://mini.kaioken.app/api/v1/threads/thr_mini/stop",
    );
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1));
    expect(toast.error.mock.calls[0]![0]).toBe(
      "Mac mini rejected the stop: this device is not signed in there.",
    );
  });
});

describe("describeRemoteWriteFailure", () => {
  it("falls back to a generic sentence for non-HTTP failures", () => {
    expect(
      describeRemoteWriteFailure("Mac mini", "reply", new TypeError("boom")),
    ).toBe("Mac mini could not complete the reply.");
  });
});
