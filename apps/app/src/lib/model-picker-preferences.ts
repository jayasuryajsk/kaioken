import type { ReasoningLevel } from "@kaioken/domain";
import { atomWithStorage } from "jotai/utils";

export const MODEL_FAVORITES_STORAGE_KEY = "bb.modelPicker.favorites";
export const MODEL_RECENTS_STORAGE_KEY = "bb.modelPicker.recents";
export const MODEL_RECENTS_LIMIT = 3;

export interface ModelSelectionEntry {
  providerId: string;
  providerLabel: string;
  model: string;
  label: string;
}

export interface ModelRecentEntry extends ModelSelectionEntry {
  reasoningLevel: ReasoningLevel;
  usedAt: number;
}

export const modelFavoritesAtom = atomWithStorage<ModelSelectionEntry[]>(
  MODEL_FAVORITES_STORAGE_KEY,
  [],
);

export const modelRecentsAtom = atomWithStorage<ModelRecentEntry[]>(
  MODEL_RECENTS_STORAGE_KEY,
  [],
);

export function modelSelectionKey(entry: {
  providerId: string;
  model: string;
}): string {
  return `${entry.providerId}::${entry.model}`;
}

export function isFavoriteModel(
  favorites: readonly ModelSelectionEntry[],
  entry: { providerId: string; model: string },
): boolean {
  const key = modelSelectionKey(entry);
  return favorites.some((favorite) => modelSelectionKey(favorite) === key);
}

export function toggleFavoriteModel(
  favorites: readonly ModelSelectionEntry[],
  entry: ModelSelectionEntry,
): ModelSelectionEntry[] {
  const key = modelSelectionKey(entry);
  if (favorites.some((favorite) => modelSelectionKey(favorite) === key)) {
    return favorites.filter((favorite) => modelSelectionKey(favorite) !== key);
  }
  return [...favorites, entry];
}

export function pushRecentModel(
  recents: readonly ModelRecentEntry[],
  entry: Omit<ModelRecentEntry, "usedAt">,
  usedAt: number = Date.now(),
): ModelRecentEntry[] {
  const key = modelSelectionKey(entry);
  return [
    { ...entry, usedAt },
    ...recents.filter((recent) => modelSelectionKey(recent) !== key),
  ].slice(0, MODEL_RECENTS_LIMIT);
}
