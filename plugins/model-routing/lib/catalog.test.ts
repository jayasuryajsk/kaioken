import { describe, expect, it, vi } from "vitest";
import {
  CATALOG_TTL_MS,
  fetchCatalog,
  filterModels,
  isStale,
  parseCatalog,
} from "./catalog";

const OPENROUTER_PAYLOAD = {
  data: [
    {
      id: "anthropic/claude-sonnet-4.5",
      name: "Anthropic: Claude Sonnet 4.5",
      context_length: 200000,
    },
    { id: "deepseek/deepseek-chat", context_length: 64000 },
    { id: "anthropic/claude-sonnet-4.5", name: "duplicate" },
  ],
};

describe("parseCatalog", () => {
  it("keeps the first entry per id, sorts by id, and falls back to the id as a label", () => {
    expect(parseCatalog(OPENROUTER_PAYLOAD)).toEqual([
      {
        id: "anthropic/claude-sonnet-4.5",
        label: "Anthropic: Claude Sonnet 4.5",
        contextLength: 200000,
      },
      {
        id: "deepseek/deepseek-chat",
        label: "deepseek/deepseek-chat",
        contextLength: 64000,
      },
    ]);
  });

  it("returns nothing for a payload that is not a model list", () => {
    expect(parseCatalog({ models: [] })).toEqual([]);
    expect(parseCatalog(null)).toEqual([]);
    expect(parseCatalog({ data: [{ name: "no id" }] })).toEqual([]);
  });
});

describe("filterModels", () => {
  it("matches id or label, case-insensitively, and passes everything through when blank", () => {
    const models = parseCatalog(OPENROUTER_PAYLOAD);
    expect(filterModels(models, "  ").length).toBe(2);
    expect(filterModels(models, "SONNET").map((model) => model.id)).toEqual([
      "anthropic/claude-sonnet-4.5",
    ]);
    expect(filterModels(models, "deepseek").map((model) => model.id)).toEqual([
      "deepseek/deepseek-chat",
    ]);
  });
});

describe("isStale", () => {
  it("expires a snapshot once the ttl has passed", () => {
    const snapshot = {
      endpoint: "openrouter" as const,
      models: [],
      fetchedAt: 1_000,
    };
    expect(isStale(snapshot, 1_000 + CATALOG_TTL_MS - 1)).toBe(false);
    expect(isStale(snapshot, 1_000 + CATALOG_TTL_MS)).toBe(true);
  });
});

describe("fetchCatalog", () => {
  it("asks OpenRouter without a key and still sends one when present", async () => {
    const fetchImpl = vi.fn(async () =>
      Response.json(OPENROUTER_PAYLOAD),
    ) as unknown as typeof fetch;
    const snapshot = await fetchCatalog({
      endpoint: "openrouter",
      key: "",
      fetchImpl,
      now: 42,
    });
    expect(snapshot).toMatchObject({ endpoint: "openrouter", fetchedAt: 42 });
    expect(snapshot.models).toHaveLength(2);
    const [url, init] = vi.mocked(fetchImpl).mock.calls[0]!;
    expect(url).toBe("https://openrouter.ai/api/v1/models");
    expect((init?.headers as Record<string, string>).authorization).toBe(
      undefined,
    );

    await fetchCatalog({
      endpoint: "openrouter",
      key: "sk-or-1",
      fetchImpl,
      now: 43,
    });
    const [, second] = vi.mocked(fetchImpl).mock.calls[1]!;
    expect((second?.headers as Record<string, string>).authorization).toBe(
      "Bearer sk-or-1",
    );
  });

  it("refuses DeepSeek without a key and a custom endpoint entirely", async () => {
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    await expect(
      fetchCatalog({ endpoint: "deepseek", key: " ", fetchImpl, now: 0 }),
    ).rejects.toThrow(/DeepSeek API key/u);
    await expect(
      fetchCatalog({ endpoint: "custom", key: "k", fetchImpl, now: 0 }),
    ).rejects.toThrow(/does not publish a model list/u);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a failing status code", async () => {
    const fetchImpl = vi.fn(
      async () => new Response("nope", { status: 401 }),
    ) as unknown as typeof fetch;
    await expect(
      fetchCatalog({ endpoint: "openrouter", key: "", fetchImpl, now: 0 }),
    ).rejects.toThrow(/HTTP 401/u);
  });
});
