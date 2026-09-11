import { atomWithStorage } from "jotai/utils";
import { z } from "zod";
import { isUnreadDoneThread } from "@kaioken/client-core";
import type { ThreadListEntry } from "@kaioken/domain";

export const SIDEBAR_PREFERENCE_STORAGE_KEY = "bb.appearance.sidebar";

export const SIDEBAR_DENSITIES = ["compact", "default", "comfortable"] as const;
export type SidebarDensity = (typeof SIDEBAR_DENSITIES)[number];

export const SIDEBAR_THREAD_LISTS = ["projects", "inbox"] as const;
export type SidebarThreadList = (typeof SIDEBAR_THREAD_LISTS)[number];

export const SIDEBAR_RECENT_COUNTS = [0, 3, 5, 8] as const;
export type SidebarRecentCount = (typeof SIDEBAR_RECENT_COUNTS)[number];

const sidebarPreferencesSchema = z.object({
  density: z.enum(SIDEBAR_DENSITIES).default("default"),
  threadList: z.enum(SIDEBAR_THREAD_LISTS).default("projects"),
  headingLabels: z.boolean().default(false),
  needsYouFirst: z.boolean().default(false),
  recentCount: z
    .union([z.literal(0), z.literal(3), z.literal(5), z.literal(8)])
    .default(0),
  hideResourceNav: z.boolean().default(false),
  rail: z.boolean().default(false),
});

export type SidebarPreferences = z.infer<typeof sidebarPreferencesSchema>;

export const DEFAULT_SIDEBAR_PREFERENCES: SidebarPreferences =
  sidebarPreferencesSchema.parse({});

export function parseSidebarPreferences(
  raw: string | null,
): SidebarPreferences {
  if (raw === null) return DEFAULT_SIDEBAR_PREFERENCES;
  try {
    const parsed = sidebarPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_SIDEBAR_PREFERENCES;
  } catch {
    return DEFAULT_SIDEBAR_PREFERENCES;
  }
}

export function readSidebarPreferences(): SidebarPreferences {
  try {
    return parseSidebarPreferences(
      localStorage.getItem(SIDEBAR_PREFERENCE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_SIDEBAR_PREFERENCES;
  }
}

export const sidebarPreferencesAtom = atomWithStorage<SidebarPreferences>(
  SIDEBAR_PREFERENCE_STORAGE_KEY,
  DEFAULT_SIDEBAR_PREFERENCES,
  {
    getItem: (key) => {
      try {
        return parseSidebarPreferences(localStorage.getItem(key));
      } catch {
        return DEFAULT_SIDEBAR_PREFERENCES;
      }
    },
    setItem: (key, value) => {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch {}
    },
    removeItem: (key) => {
      try {
        localStorage.removeItem(key);
      } catch {}
    },
  },
  { getOnInit: true },
);

const FLAG_ATTRIBUTES: ReadonlyArray<
  [keyof SidebarPreferences & string, string]
> = [["headingLabels", "data-sidebar-heading-labels"]];

export function applySidebarPreferences(
  preferences: SidebarPreferences,
  root: HTMLElement = document.documentElement,
): void {
  root.setAttribute("data-sidebar-density", preferences.density);
  for (const [key, attribute] of FLAG_ATTRIBUTES) {
    if (preferences[key] === true) root.setAttribute(attribute, "");
    else root.removeAttribute(attribute);
  }
}

export function initializeSidebarPreferences(): void {
  applySidebarPreferences(readSidebarPreferences());
}

export function previewSidebarPreference<K extends keyof SidebarPreferences>(
  preferences: SidebarPreferences,
  preview: { key: K; value: SidebarPreferences[K] } | null,
): void {
  if (preview === null) {
    applySidebarPreferences(preferences);
    return;
  }
  applySidebarPreferences({ ...preferences, [preview.key]: preview.value });
}

export function sidebarAttentionRank(thread: ThreadListEntry): 0 | 1 | 2 {
  if (thread.hasPendingInteraction) return 0;
  if (thread.queuedWork === "failed") return 1;
  if (isUnreadDoneThread(thread) && thread.status === "error") return 1;
  return 2;
}

export function compareByAttentionThen<
  T extends (left: ThreadListEntry, right: ThreadListEntry) => number,
>(base: T): T {
  const comparator = ((left, right) => {
    const rank = sidebarAttentionRank(left) - sidebarAttentionRank(right);
    return rank !== 0 ? rank : base(left, right);
  }) as T;
  Object.assign(comparator, base);
  return comparator;
}

export function selectRecentThreads(
  threads: readonly ThreadListEntry[],
  count: number,
): ThreadListEntry[] {
  if (count <= 0) return [];
  return [...threads]
    .filter(
      (thread) => thread.visibility !== "hidden" && thread.archivedAt === null,
    )
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, count);
}
