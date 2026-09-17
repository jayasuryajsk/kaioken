import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Miniflare } from "miniflare";
import { RelayStore } from "./store.js";

let mf: Miniflare;
let kv: KVNamespace;

beforeAll(async () => {
  mf = new Miniflare({
    modules: true,
    script: "export default { fetch() { return new Response('ok'); } };",
    compatibilityDate: "2026-06-11",
    kvNamespaces: ["STATE", "OTHER_STATE"],
  });
  const binding = (await mf.getKVNamespace("STATE")) as unknown as KVNamespace;
  kv = {
    get: binding.get.bind(binding),
    getWithMetadata: binding.getWithMetadata.bind(binding),
    put: binding.put.bind(binding),
    delete: binding.delete.bind(binding),
    list: binding.list.bind(binding),
  };
});

afterAll(async () => {
  await mf?.dispose();
});

describe("relay device directory", () => {
  it("reduces 120 half-minute polls to 12 KV scans with fresh store instances", async () => {
    let now = 0;
    const store = new RelayStore(kv, "studio", () => now);
    await store.pairServer("studio", "Mac Studio", "directory-studio");
    const scans = vi.spyOn(kv, "list");
    try {
      for (let poll = 0; poll < 120; poll += 1) {
        now = poll * 30_000;
        const entries = await new RelayStore(
          kv,
          "studio",
          () => now,
        ).listServerDirectory();
        expect(entries).toContainEqual({
          handle: "studio",
          name: "Mac Studio",
        });
        expect(entries.every((entry) => !("credentialHash" in entry))).toBe(
          true,
        );
      }
      expect(scans).toHaveBeenCalledTimes(12);
    } finally {
      scans.mockRestore();
    }
  });

  it("shares concurrent directory scans and refreshes after pairing or disconnecting", async () => {
    const first = new RelayStore(kv, "studio");
    const second = new RelayStore(kv, "studio");
    await first.pairServer("book", "MacBook", "directory-book");
    const scans = vi.spyOn(kv, "list");
    try {
      const results = await Promise.all([
        first.listServerDirectory(),
        second.listServerDirectory(),
        new RelayStore(kv, "studio").listServerDirectory(),
      ]);
      expect(scans).toHaveBeenCalledTimes(1);
      for (const entries of results) {
        expect(entries).toContainEqual({ handle: "book", name: "MacBook" });
      }
      await second.pairServer("book", "Renamed MacBook", "directory-book-new");
      expect(await first.listServerDirectory()).toContainEqual({
        handle: "book",
        name: "Renamed MacBook",
      });
      await second.unpairServer("book");
      expect(await first.listServerDirectory()).not.toContainEqual({
        handle: "book",
        name: "Renamed MacBook",
      });
      expect(scans).toHaveBeenCalledTimes(3);
    } finally {
      scans.mockRestore();
    }
  });

  it("keeps directory entries separate between KV namespaces", async () => {
    const otherKv = (await mf.getKVNamespace(
      "OTHER_STATE",
    )) as unknown as KVNamespace;
    const first = new RelayStore(kv, "studio");
    const other = new RelayStore(otherKv, "studio");
    await first.pairServer("studio", "Personal Studio", "personal-studio");
    await other.pairServer("studio", "Other Studio", "other-studio");
    expect(await first.listServerDirectory()).toContainEqual({
      handle: "studio",
      name: "Personal Studio",
    });
    expect(await other.listServerDirectory()).toEqual([
      { handle: "studio", name: "Other Studio" },
    ]);
  });

  it("does not use stale directory entries to authenticate removed servers", async () => {
    const store = new RelayStore(kv, "studio");
    const credential = "removed-server-credential";
    const record = await store.pairServer("removed", "Removed Mac", credential);
    await store.listServerDirectory();
    await kv.delete("server:removed");
    await kv.delete(`token:${record.credentialHash}`);
    expect(await store.listServerDirectory()).toContainEqual({
      handle: "removed",
      name: "Removed Mac",
    });
    expect(
      await new RelayStore(kv, "studio").resolveCredential(credential),
    ).toBeNull();
  });
});
