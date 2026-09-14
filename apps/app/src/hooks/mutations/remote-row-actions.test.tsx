// @vitest-environment jsdom

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FederatedServer } from "@kaioken/client-core";
import { resetRemoteSdkForTest } from "@/lib/federation/remote-sdk";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import { remoteServerSnapshotQueryKey } from "../queries/federation-queries";
import { useRemoteRowActions } from "./remote-row-actions";

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
const calls: Array<{ method: string; path: string; body: unknown }> = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

beforeEach(() => {
  calls.length = 0;
  fetchMock.mockImplementation(async (input, init) => {
    const url = new URL(String(input instanceof Request ? input.url : input));
    calls.push({
      method: (init?.method ?? "GET").toUpperCase(),
      path: url.pathname,
      body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
    });
    if (url.pathname.endsWith("/child-summary")) {
      return json({ nonDeletedChildCount: 2 });
    }
    if (url.pathname === "/api/v1/threads/thr_gone") {
      return json({ error: "offline" }, 503);
    }
    return json({ ok: true });
  });
  vi.stubGlobal("fetch", fetchMock);
  resetRemoteSdkForTest();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  toast.error.mockReset();
});

describe("useRemoteRowActions", () => {
  it("renames, pins, and moves a thread on the remote server and refreshes that server's snapshot", async () => {
    const { wrapper, queryClient } = createQueryClientTestHarness();
    const invalidate = vi.spyOn(queryClient, "invalidateQueries");
    const { result } = renderHook(() => useRemoteRowActions(), { wrapper });
    const target = { server: MINI, id: "thr_1" };

    await act(async () => {
      expect(await result.current.renameThread(target, "Renamed")).toBe(true);
      expect(await result.current.setThreadPinned(target, true)).toBe(true);
      expect(
        await result.current.moveThread(
          target,
          { pinnedAt: 5, sectionId: "mini:sec_old" },
          "mini:sec_new",
        ),
      ).toBe(true);
    });

    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "PATCH /api/v1/threads/thr_1",
      "POST /api/v1/threads/thr_1/pin",
      "POST /api/v1/threads/thr_1/unpin",
      "PATCH /api/v1/threads/thr_1",
    ]);
    expect(calls[0]!.body).toEqual({ title: "Renamed" });
    expect(calls[3]!.body).toEqual({ sectionId: "sec_new" });
    expect(
      invalidate.mock.calls.filter(
        ([filters]) =>
          JSON.stringify(filters?.queryKey) ===
          JSON.stringify(remoteServerSnapshotQueryKey("mini")),
      ).length,
    ).toBeGreaterThanOrEqual(3);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it("reads the child count before a delete and deletes with confirmation", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useRemoteRowActions(), { wrapper });
    const target = { server: MINI, id: "thr_1" };
    let count: number | null = null;
    await act(async () => {
      count = await result.current.childThreadCount(target);
      await result.current.deleteThread(target, true);
    });
    expect(count).toBe(2);
    const del = calls.find((call) => call.method === "DELETE");
    expect(del?.path).toBe("/api/v1/threads/thr_1");
  });

  it("names the server in a toast when it fails and reports the failure to the caller", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useRemoteRowActions(), { wrapper });
    let ok = true;
    await act(async () => {
      ok = await result.current.renameThread(
        { server: MINI, id: "thr_gone" },
        "x",
      );
    });
    expect(ok).toBe(false);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.error.mock.calls[0]![0]).toContain("Mac mini");
  });

  it("renames and removes projects on the remote server", async () => {
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useRemoteRowActions(), { wrapper });
    const target = { server: MINI, id: "proj_1" };
    await act(async () => {
      await result.current.renameProject(target, "Renamed repo");
      await result.current.moveProject(target, null);
      await result.current.deleteProject(target);
    });
    expect(calls.map((call) => `${call.method} ${call.path}`)).toEqual([
      "PATCH /api/v1/projects/proj_1",
      "PATCH /api/v1/projects/proj_1",
      "DELETE /api/v1/projects/proj_1",
    ]);
    expect(calls[0]!.body).toEqual({ name: "Renamed repo" });
    expect(calls[1]!.body).toEqual({ sectionId: null });
  });
});
