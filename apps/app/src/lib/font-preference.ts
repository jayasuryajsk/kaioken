import { z } from "zod";

export const FONT_ASPECTS = [
  "interface",
  "headings",
  "conversation",
  "code",
] as const;
export type FontAspect = (typeof FONT_ASPECTS)[number];

export const FONT_PREFERENCE_STORAGE_KEY = "bb.appearance.fonts";

export const INHERIT_FONT = "inherit";
export const CUSTOM_FONT = "custom";

export interface FontOption {
  id: string;
  label: string;
  family: string;
  aspects: readonly FontAspect[];
  probe?: string;
}

const TEXT: readonly FontAspect[] = ["interface", "headings", "conversation"];
const ALL: readonly FontAspect[] = FONT_ASPECTS;

export const FONT_OPTIONS: readonly FontOption[] = [
  {
    id: "inter",
    label: "Inter",
    family: '"Inter Variable", Inter, sans-serif',
    aspects: TEXT,
  },
  {
    id: "system",
    label: "System UI",
    family: "system-ui, -apple-system, sans-serif",
    aspects: TEXT,
  },
  {
    id: "american-typewriter",
    label: "American Typewriter",
    family: '"American Typewriter", "Inter Variable", Inter, serif',
    aspects: ALL,
    probe: "American Typewriter",
  },
  {
    id: "helvetica-neue",
    label: "Helvetica Neue",
    family: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    aspects: TEXT,
    probe: "Helvetica Neue",
  },
  {
    id: "avenir-next",
    label: "Avenir Next",
    family: '"Avenir Next", Avenir, "Inter Variable", sans-serif',
    aspects: TEXT,
    probe: "Avenir Next",
  },
  {
    id: "georgia",
    label: "Georgia",
    family: "Georgia, serif",
    aspects: TEXT,
    probe: "Georgia",
  },
  {
    id: "charter",
    label: "Charter",
    family: "Charter, Georgia, serif",
    aspects: TEXT,
    probe: "Charter",
  },
  {
    id: "iowan",
    label: "Iowan Old Style",
    family: '"Iowan Old Style", Palatino, Georgia, serif',
    aspects: TEXT,
    probe: "Iowan Old Style",
  },
  {
    id: "palatino",
    label: "Palatino",
    family: 'Palatino, "Palatino Linotype", "Book Antiqua", serif',
    aspects: TEXT,
    probe: "Palatino",
  },
  {
    id: "baskerville",
    label: "Baskerville",
    family: "Baskerville, Georgia, serif",
    aspects: TEXT,
    probe: "Baskerville",
  },
  {
    id: "system-mono",
    label: "System monospace",
    family:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    aspects: ["code"],
  },
  {
    id: "sf-mono",
    label: "SF Mono",
    family: '"SF Mono", ui-monospace, Menlo, monospace',
    aspects: ["code"],
    probe: "SF Mono",
  },
  {
    id: "menlo",
    label: "Menlo",
    family: "Menlo, Monaco, monospace",
    aspects: ["code"],
    probe: "Menlo",
  },
  {
    id: "monaco",
    label: "Monaco",
    family: "Monaco, Menlo, monospace",
    aspects: ["code"],
    probe: "Monaco",
  },
  {
    id: "courier-new",
    label: "Courier New",
    family: '"Courier New", Courier, monospace',
    aspects: ALL,
    probe: "Courier New",
  },
];

const fontPreferencesSchema = z.object({
  interface: z.string().min(1).default("inter"),
  headings: z.string().min(1).default(INHERIT_FONT),
  conversation: z.string().min(1).default(INHERIT_FONT),
  code: z.string().min(1).default("system-mono"),
  custom: z
    .object({
      interface: z.string().optional(),
      headings: z.string().optional(),
      conversation: z.string().optional(),
      code: z.string().optional(),
    })
    .default({}),
});

export type FontPreferences = z.infer<typeof fontPreferencesSchema>;

export const DEFAULT_FONT_PREFERENCES: FontPreferences =
  fontPreferencesSchema.parse({});

export function parseFontPreferences(raw: string | null): FontPreferences {
  if (raw === null) return DEFAULT_FONT_PREFERENCES;
  try {
    const parsed = fontPreferencesSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : DEFAULT_FONT_PREFERENCES;
  } catch {
    return DEFAULT_FONT_PREFERENCES;
  }
}

export function readFontPreferences(): FontPreferences {
  try {
    return parseFontPreferences(
      localStorage.getItem(FONT_PREFERENCE_STORAGE_KEY),
    );
  } catch {
    return DEFAULT_FONT_PREFERENCES;
  }
}

export function writeFontPreferences(preferences: FontPreferences): void {
  try {
    localStorage.setItem(
      FONT_PREFERENCE_STORAGE_KEY,
      JSON.stringify(preferences),
    );
  } catch {}
}

const ASPECT_PROPERTY: Record<FontAspect, string> = {
  interface: "--font-sans",
  headings: "--font-heading",
  conversation: "--font-prose",
  code: "--font-mono",
};

export function resolveFontFamily(
  preferences: FontPreferences,
  aspect: FontAspect,
): string | null {
  const id = preferences[aspect];
  if (id === INHERIT_FONT) return null;
  if (id === CUSTOM_FONT) {
    const custom = preferences.custom[aspect]?.trim();
    return custom ? quoteFamily(custom) : null;
  }
  const option = FONT_OPTIONS.find((entry) => entry.id === id);
  if (!option) return null;
  if (aspect === "interface" && id === "inter") return null;
  if (aspect === "code" && id === "system-mono") return null;
  return option.family;
}

function quoteFamily(name: string): string {
  const quoted = name.includes('"') || name.includes(",") ? name : `"${name}"`;
  return `${quoted}, sans-serif`;
}

export function applyFontPreferences(
  preferences: FontPreferences,
  root: HTMLElement = document.documentElement,
): void {
  for (const aspect of FONT_ASPECTS) {
    const family = resolveFontFamily(preferences, aspect);
    if (family === null) root.style.removeProperty(ASPECT_PROPERTY[aspect]);
    else root.style.setProperty(ASPECT_PROPERTY[aspect], family);
  }
}

export function initializeFontPreferences(): void {
  applyFontPreferences(readFontPreferences());
}

export function previewFontPreference(
  preferences: FontPreferences,
  preview: { aspect: FontAspect; optionId: string } | null,
): void {
  if (preview === null) {
    applyFontPreferences(preferences);
    return;
  }
  applyFontPreferences({ ...preferences, [preview.aspect]: preview.optionId });
}

const installedCache = new Map<string, boolean>();

export function isFontInstalled(family: string): boolean {
  const cached = installedCache.get(family);
  if (cached !== undefined) return cached;
  let installed = true;
  try {
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (context) {
      const sample = "mmmmmmmmmmlliI1oO0wW";
      const widths = ["monospace", "serif", "sans-serif"].map((generic) => {
        context.font = `72px ${generic}`;
        const base = context.measureText(sample).width;
        context.font = `72px "${family}", ${generic}`;
        return context.measureText(sample).width !== base;
      });
      installed = widths.some(Boolean);
    }
  } catch {
    installed = true;
  }
  installedCache.set(family, installed);
  return installed;
}
