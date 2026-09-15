// @vitest-environment jsdom

import { afterEach, expect, it, vi } from "vitest";
import {
  CONNECTION_IDENTITY_HEADER,
  connectionDiscoverySchema,
} from "@kaioken/server-contract";
import { fetchWithAppSurface } from "../app-surface";
import { listAccountServersResultSchema } from "./account-servers";

const fixtures = vi.hoisted(() => ({
  serverId: "74bcf65a-a849-4577-9a6f-c9b540940afb",
}));
vi.mock("./workspace-protocol", () => ({
  workspaceEmbedding: { serverId: fixtures.serverId },
}));
afterEach(() => vi.unstubAllGlobals());

it("pins same-origin plugin and image requests and preserves Request headers without leaking identity externally", async () => {
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response("ok"));
  vi.stubGlobal("fetch", fetch);
  for (const path of [
    "/api/v1/plugins/contributions",
    "/api/v1/plugins/plugin/mentions/search",
    "/api/v1/projects/project/attachments/image.png",
  ]) {
    await fetchWithAppSurface(path);
    const [, init] = fetch.mock.lastCall!;
    expect(new Headers(init?.headers).get(CONNECTION_IDENTITY_HEADER)).toBe(
      fixtures.serverId,
    );
  }
  await fetchWithAppSurface(
    new Request(`${window.location.origin}/api/v1/example`, {
      headers: { "x-test": "retained" },
    }),
  );
  expect(new Headers(fetch.mock.lastCall?.[1]?.headers).get("x-test")).toBe(
    "retained",
  );
  await fetchWithAppSurface("https://other.example/image.png");
  expect(fetch).toHaveBeenLastCalledWith(
    "https://other.example/image.png",
    undefined,
  );
});

it("rejects SSH selector prefixes at account discovery boundaries", () => {
  const discovery = {
    selfHandle: "local-machine",
    servers: [
      {
        handle: "ssh.work",
        name: "Work",
        live: true,
        url: "https://ssh.work.kaioken.app",
      },
    ],
  };
  expect(connectionDiscoverySchema.safeParse(discovery).success).toBe(false);
  expect(listAccountServersResultSchema.safeParse(discovery).success).toBe(
    false,
  );
  discovery.servers[0]!.handle = "work";
  expect(connectionDiscoverySchema.safeParse(discovery).success).toBe(true);
});
