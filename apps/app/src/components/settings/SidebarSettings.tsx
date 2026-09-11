import { useEffect, useRef } from "react";
import { useAtom } from "jotai";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@kaioken/shared-ui/coarse-pointer-sizing";
import { Button } from "@kaioken/shared-ui/button";
import { Switch } from "@kaioken/shared-ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@kaioken/shared-ui/dropdown-menu";
import { SettingsWithControl } from "@/components/ui/settings-section";
import {
  applySidebarPreferences,
  DEFAULT_SIDEBAR_PREFERENCES,
  previewSidebarPreference,
  sidebarPreferencesAtom,
  type SidebarDensity,
  type SidebarPreferences,
  type SidebarRecentCount,
  type SidebarSurface,
} from "@/lib/sidebar-preference";

const TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-44";
const CONTENT_CLASS = "min-w-[var(--radix-dropdown-menu-trigger-width)]";

const DENSITY_OPTIONS: ReadonlyArray<{
  value: SidebarDensity;
  label: string;
  description: string;
}> = [
  { value: "compact", label: "Compact", description: "24px rows" },
  { value: "default", label: "Default", description: "28px rows" },
  { value: "comfortable", label: "Comfortable", description: "32px rows" },
];

const SURFACE_OPTIONS: ReadonlyArray<{
  value: SidebarSurface;
  label: string;
  description: string;
}> = [
  { value: "match", label: "Match canvas", description: "Same as the page" },
  { value: "recessed", label: "Recessed", description: "A step darker" },
  { value: "aura", label: "Aura", description: "Warm red-black tint" },
];

const RECENT_OPTIONS: ReadonlyArray<{
  value: SidebarRecentCount;
  label: string;
}> = [
  { value: 0, label: "Off" },
  { value: 3, label: "3 threads" },
  { value: 5, label: "5 threads" },
  { value: 8, label: "8 threads" },
];

interface ChoiceProps<K extends keyof SidebarPreferences> {
  label: string;
  description: string;
  preferenceKey: K;
  options: ReadonlyArray<{
    value: SidebarPreferences[K];
    label: string;
    description?: string;
  }>;
  preferences: SidebarPreferences;
  onPreview: (preview: { key: K; value: SidebarPreferences[K] } | null) => void;
  onSelect: (key: K, value: SidebarPreferences[K]) => void;
}

function SidebarChoice<K extends keyof SidebarPreferences>({
  label,
  description,
  preferenceKey,
  options,
  preferences,
  onPreview,
  onSelect,
}: ChoiceProps<K>) {
  const selectedRef = useRef(false);
  const current = options.find(
    (option) => option.value === preferences[preferenceKey],
  );
  return (
    <SettingsWithControl label={label} description={description}>
      <DropdownMenu
        onOpenChange={(open) => {
          if (open) {
            selectedRef.current = false;
            return;
          }
          if (!selectedRef.current) onPreview(null);
        }}
      >
        <DropdownMenuTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className={TRIGGER_CLASS}
            aria-label={label}
          >
            <span className="min-w-0 truncate">
              {current?.label ?? String(preferences[preferenceKey])}
            </span>
            <Icon
              name="ChevronDown"
              className="size-3.5 text-muted-foreground"
            />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className={CONTENT_CLASS}>
          {options.map((option) => (
            <DropdownMenuItem
              key={String(option.value)}
              onFocus={() =>
                onPreview({ key: preferenceKey, value: option.value })
              }
              onBlur={() => {
                if (!selectedRef.current) onPreview(null);
              }}
              onSelect={() => {
                selectedRef.current = true;
                onSelect(preferenceKey, option.value);
              }}
              className="flex items-start gap-2"
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{option.label}</span>
                {option.description ? (
                  <span className="truncate text-xs text-muted-foreground">
                    {option.description}
                  </span>
                ) : null}
              </span>
              <Icon
                name="Check"
                className={cn(
                  "ml-auto mt-0.5",
                  preferences[preferenceKey] !== option.value && "opacity-0",
                  COARSE_POINTER_ICON_SIZE_CLASS,
                )}
              />
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </SettingsWithControl>
  );
}

interface ToggleProps {
  label: string;
  description: string;
  preferenceKey:
    | "headingLabels"
    | "accentActive"
    | "statusTint"
    | "needsYouFirst"
    | "hideResourceNav"
    | "projectStrips";
  preferences: SidebarPreferences;
  onChange: (key: ToggleProps["preferenceKey"], value: boolean) => void;
}

function SidebarToggle({
  label,
  description,
  preferenceKey,
  preferences,
  onChange,
}: ToggleProps) {
  return (
    <SettingsWithControl label={label} description={description}>
      <Switch
        checked={preferences[preferenceKey]}
        onCheckedChange={(checked) => onChange(preferenceKey, checked)}
        aria-label={label}
      />
    </SettingsWithControl>
  );
}

export function SidebarSettings() {
  const [preferences, setPreferences] = useAtom(sidebarPreferencesAtom);

  useEffect(() => {
    applySidebarPreferences(preferences);
  }, [preferences]);

  const preview = <K extends keyof SidebarPreferences>(
    next: { key: K; value: SidebarPreferences[K] } | null,
  ) => previewSidebarPreference(preferences, next);
  const select = <K extends keyof SidebarPreferences>(
    key: K,
    value: SidebarPreferences[K],
  ) => setPreferences((prev) => ({ ...prev, [key]: value }));
  const isDefault = (
    Object.keys(DEFAULT_SIDEBAR_PREFERENCES) as Array<keyof SidebarPreferences>
  ).every((key) => preferences[key] === DEFAULT_SIDEBAR_PREFERENCES[key]);

  return (
    <div className="space-y-5">
      <SidebarChoice
        label="Sidebar density"
        description="Row height for threads and sections."
        preferenceKey="density"
        options={DENSITY_OPTIONS}
        preferences={preferences}
        onPreview={preview}
        onSelect={select}
      />
      <SidebarChoice
        label="Sidebar surface"
        description="Background of the sidebar relative to the page."
        preferenceKey="surface"
        options={SURFACE_OPTIONS}
        preferences={preferences}
        onPreview={preview}
        onSelect={select}
      />
      <SidebarChoice
        label="Recent threads"
        description="A section at the top with the threads you touched last, across projects."
        preferenceKey="recentCount"
        options={RECENT_OPTIONS}
        preferences={preferences}
        onPreview={preview}
        onSelect={select}
      />
      <SidebarToggle
        label="Needs you first"
        description="Threads waiting on a question or approval, then failed ones, sort to the top of each section."
        preferenceKey="needsYouFirst"
        preferences={preferences}
        onChange={select}
      />
      <SidebarToggle
        label="Tint rows by status"
        description="Amber for threads waiting on you, red for failures."
        preferenceKey="statusTint"
        preferences={preferences}
        onChange={select}
      />
      <SidebarToggle
        label="Accent the active thread"
        description="A red edge on the selected row."
        preferenceKey="accentActive"
        preferences={preferences}
        onChange={select}
      />
      <SidebarToggle
        label="Project color strips"
        description="A colored edge on each project group, derived from its name."
        preferenceKey="projectStrips"
        preferences={preferences}
        onChange={select}
      />
      <SidebarToggle
        label="Section labels in the headings font"
        description="Pinned, Threads, and project names use the Headings font from above."
        preferenceKey="headingLabels"
        preferences={preferences}
        onChange={select}
      />
      <SidebarToggle
        label="Hide Plugins and Skills from navigation"
        description="They stay reachable from Settings and the command palette."
        preferenceKey="hideResourceNav"
        preferences={preferences}
        onChange={select}
      />
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          disabled={isDefault}
          onClick={() => setPreferences(DEFAULT_SIDEBAR_PREFERENCES)}
        >
          Reset sidebar
        </Button>
      </div>
    </div>
  );
}
