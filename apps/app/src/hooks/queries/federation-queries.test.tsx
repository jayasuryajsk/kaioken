// @vitest-environment jsdom

import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeThreadListEntry } from "@kaioken/test-helpers/domain-fixtures";
import {
  FEDERATION_SERVERS_STORAGE_KEY,
  writeStoredServers,
} from "@/lib/federation/account-servers";
import { resetRemoteSdkForTest } from "@/lib/federation/remote-sdk";
import {
  FEDERATION_SNAPSHOT_STORAGE_PREFIX,
  writeStoredSnapshot,
} from "@/lib/federation/remote-snapshots";
import { createQueryClientTestHarness } from "@/test/queryClientTestHarness";
import {
  makeProjectWithThreadsResponse,
  makeSidebarBootstrapResponse,
} from "@/test/fixtures/projects";
import { useFederatedRemotes } from "./federation-queries";

const MINI_BOOTSTRAP = makeSidebarBootstrapResponse({
  projects: [
    makeProjectWithThreadsResponse({
      id: "proj_mini",
      name: "mini repo",
      threads: [
        makeThreadListEntry({ id: "thr_mini", projectId: "proj_mini" }),
      ],
    }),
  ],
});

const SERVERS_RPC_RESULT = {
  ok: true,
  result: {
    selfHandle: "studio",
    servers: [
      {
        handle: "studio",
        name: "MacBook",
        live: true,
        url: "https://studio.kaioken.app",
      },
      {
        handle: "mini",
        name: "Mac mini",
        live: true,
        url: "https://mini.kaioken.app",
      },
      {
        handle: "work",
        name: "Mac Studio",
        live: true,
        url: "https://work.kaioken.app",
      },
    ],
  },
};

const fetchMock = vi.fn<typeof fetch>();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function respondByHost(handlers: Record<string, () => Response>) {
  fetchMock.mockImplementation(async (input) => {
    const url = new URL(
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url,
    );
    const handler = handlers[url.hostname];
    if (handler === undefined)
      throw new TypeError(`unexpected host ${url.hostname}`);
    return handler();
  });
}

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  resetRemoteSdkForTest();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  fetchMock.mockReset();
  window.localStorage.clear();
});

describe("useFederatedRemotes", () => {
  it("marks one server live and a 503 server offline without throwing", async () => {
    respondByHost({
      localhost: () => json(SERVERS_RPC_RESULT),
      "mini.kaioken.app": () => json(MINI_BOOTSTRAP),
      "work.kaioken.app": () => json({ error: "offline" }, 503),
    });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useFederatedRemotes(), { wrapper });

    await waitFor(() => {
      expect(result.current.remotes.map((remote) => remote.status)).toEqual([
        "live",
        "offline",
      ]);
    });
    expect(result.current.servers.map((server) => server.home)).toEqual([
      true,
      false,
      false,
    ]);
    const mini = result.current.remotes[0]!;
    expect(mini.bootstrap?.projects[0]?.threads[0]?.id).toBe("thr_mini");
    expect(mini.fetchedAt).not.toBeNull();
    const work = result.current.remotes[1]!;
    expect(work.bootstrap).toBeNull();
    expect(
      window.localStorage.getItem(`${FEDERATION_SNAPSHOT_STORAGE_PREFIX}mini`),
    ).not.toBeNull();
    const remoteCalls = fetchMock.mock.calls.filter(([input]) =>
      String(input).includes("kaioken.app"),
    );
    for (const [, init] of remoteCalls) {
      expect(init?.credentials).toBe("include");
      expect(init?.mode).toBe("cors");
    }
  });

  it("keeps the persisted snapshot for a server that has gone offline", async () => {
    writeStoredServers([
      {
        handle: "studio",
        name: "MacBook",
        url: "https://studio.kaioken.app",
        live: true,
        lastSeenAt: 1,
        home: true,
      },
      {
        handle: "mini",
        name: "Mac mini",
        url: "https://mini.kaioken.app",
        live: true,
        lastSeenAt: 1,
        home: false,
      },
    ]);
    writeStoredSnapshot("mini", { fetchedAt: 500, bootstrap: MINI_BOOTSTRAP });
    respondByHost({
      "mini.kaioken.app": () => json({ error: "offline" }, 503),
      localhost: () =>
        json({
          ok: true,
          result: {
            selfHandle: "studio",
            servers: [
              {
                handle: "studio",
                name: "MacBook",
                live: true,
                url: "https://studio.kaioken.app",
              },
              {
                handle: "mini",
                name: "Mac mini",
                live: false,
                url: "https://mini.kaioken.app",
              },
            ],
          },
        }),
    });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useFederatedRemotes(), { wrapper });

    await waitFor(() => {
      expect(
        result.current.servers.find((s) => s.handle === "mini")?.live,
      ).toBe(false);
    });
    const mini = result.current.remotes[0]!;
    expect(mini.status).toBe("offline");
    expect(mini.bootstrap?.projects[0]?.id).toBe("proj_mini");
    expect(mini.fetchedAt).toBe(500);
    expect(mini.server.lastSeenAt).toBe(1);
  });

  it("falls back to the stored list with remotes offline when the home RPC fails", async () => {
    writeStoredServers([
      {
        handle: "studio",
        name: "MacBook",
        url: "https://studio.kaioken.app",
        live: true,
        lastSeenAt: 1,
        home: true,
      },
      {
        handle: "mini",
        name: "Mac mini",
        url: "https://mini.kaioken.app",
        live: true,
        lastSeenAt: 7,
        home: false,
      },
    ]);
    respondByHost({
      localhost: () => json({ ok: false, error: "plugin disabled" }, 503),
    });
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(() => useFederatedRemotes(), { wrapper });

    await waitFor(() => {
      expect(result.current.remotes[0]?.status).toBe("offline");
    });
    expect(
      result.current.servers.map((server) => [server.handle, server.live]),
    ).toEqual([
      ["studio", true],
      ["mini", false],
    ]);
    expect(
      window.localStorage.getItem(FEDERATION_SERVERS_STORAGE_KEY),
    ).not.toBeNull();
  });

  it("returns nothing when merging is disabled", () => {
    writeStoredServers([
      {
        handle: "mini",
        name: "Mac mini",
        url: "https://mini.kaioken.app",
        live: true,
        lastSeenAt: 1,
        home: false,
      },
    ]);
    const { wrapper } = createQueryClientTestHarness();
    const { result } = renderHook(
      () => useFederatedRemotes({ enabled: false }),
      { wrapper },
    );
    expect(result.current.servers).toEqual([]);
    expect(result.current.remotes).toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
