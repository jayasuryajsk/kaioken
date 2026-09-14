import { z } from "zod";
import { ENDPOINTS, type EndpointId } from "./routing";

export const CATALOG_TTL_MS = 10 * 60_000;

const modelEntrySchema = z
  .object({
    id: z.string().min(1),
    name: z.string().optional(),
    context_length: z.number().optional(),
  })
  .loose();

const catalogResponseSchema = z.object({
  data: z.array(modelEntrySchema),
});

export interface CatalogModel {
  id: string;
  label: string;
  contextLength: number | null;
}

export interface CatalogSnapshot {
  endpoint: EndpointId;
  models: CatalogModel[];
  fetchedAt: number;
}

export function parseCatalog(payload: unknown): CatalogModel[] {
  const parsed = catalogResponseSchema.safeParse(payload);
  if (!parsed.success) return [];
  const seen = new Set<string>();
  const models: CatalogModel[] = [];
  for (const entry of parsed.data.data) {
    if (seen.has(entry.id)) continue;
    seen.add(entry.id);
    models.push({
      id: entry.id,
      label: entry.name ?? entry.id,
      contextLength: entry.context_length ?? null,
    });
  }
  return models.sort((left, right) => left.id.localeCompare(right.id));
}

export function isStale(snapshot: CatalogSnapshot, now: number): boolean {
  return now - snapshot.fetchedAt >= CATALOG_TTL_MS;
}

export function filterModels(
  models: readonly CatalogModel[],
  query: string,
): CatalogModel[] {
  const needle = query.trim().toLowerCase();
  if (needle.length === 0) return [...models];
  return models.filter(
    (model) =>
      model.id.toLowerCase().includes(needle) ||
      model.label.toLowerCase().includes(needle),
  );
}

export interface FetchCatalogArgs {
  endpoint: EndpointId;
  key: string;
  fetchImpl: typeof fetch;
  now: number;
  timeoutMs?: number;
}

export async function fetchCatalog({
  endpoint,
  key,
  fetchImpl,
  now,
  timeoutMs = 10_000,
}: FetchCatalogArgs): Promise<CatalogSnapshot> {
  const definition = ENDPOINTS[endpoint];
  if (definition.modelsUrl === null) {
    throw new Error(`${definition.label} does not publish a model list.`);
  }
  if (definition.modelsNeedKey && key.trim().length === 0) {
    throw new Error(`Add the ${definition.label} API key first.`);
  }
  const headers: Record<string, string> = { accept: "application/json" };
  if (key.trim().length > 0) {
    headers.authorization = `Bearer ${key.trim()}`;
  }
  const response = await fetchImpl(definition.modelsUrl, {
    headers,
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) {
    throw new Error(
      `${definition.label} returned HTTP ${response.status} for its model list.`,
    );
  }
  const payload: unknown = await response.json();
  return { endpoint, models: parseCatalog(payload), fetchedAt: now };
}
