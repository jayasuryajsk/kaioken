import { useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { COARSE_POINTER_ICON_SIZE_CLASS } from "@kaioken/shared-ui/coarse-pointer-sizing";
import { Button } from "@kaioken/shared-ui/button";
import { Input } from "@kaioken/shared-ui/input";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@kaioken/shared-ui/dropdown-menu";
import { SettingsWithControl } from "@/components/ui/settings-section";
import {
  applyFontPreferences,
  CUSTOM_FONT,
  DEFAULT_FONT_PREFERENCES,
  FONT_ASPECTS,
  FONT_OPTIONS,
  INHERIT_FONT,
  isFontInstalled,
  previewFontPreference,
  readFontPreferences,
  writeFontPreferences,
  type FontAspect,
  type FontPreferences,
} from "@/lib/font-preference";

const ASPECT_COPY: Record<
  FontAspect,
  { label: string; description: string; sample: string }
> = {
  interface: {
    label: "Interface font",
    description:
      "Sidebar, buttons, pickers, settings: everything that is not text from a thread.",
    sample: "New thread · Plugins · Skills · Automations",
  },
  headings: {
    label: "Headings",
    description: "Titles in the app and headings inside messages.",
    sample: "Turn Kaioken into a kanban board",
  },
  conversation: {
    label: "Conversation",
    description: "User and agent messages in the thread timeline.",
    sample:
      "I traced the flaky test to a race in the queue drain. Fix is two lines; opening a PR now.",
  },
  code: {
    label: "Code",
    description: "Code blocks, diffs, file viewers, and terminals.",
    sample: 'const pill = view.dom.querySelector("[data-thread-mention]");',
  },
};

const TRIGGER_CLASS =
  "h-7 w-full justify-between border-border/60 bg-card px-2 text-xs sm:w-44";

interface FontMenuItemProps {
  active: boolean;
  aspect: FontAspect;
  children: React.ReactNode;
  installed: boolean;
  onPreview: (aspect: FontAspect, optionId: string | null) => void;
  onSelect: (aspect: FontAspect, optionId: string) => void;
  optionId: string;
  style?: React.CSSProperties;
}

function FontMenuItem({
  active,
  aspect,
  children,
  installed,
  onPreview,
  onSelect,
  optionId,
  style,
}: FontMenuItemProps) {
  return (
    <DropdownMenuItem
      onFocus={() => onPreview(aspect, optionId)}
      onBlur={() => onPreview(aspect, null)}
      onSelect={() => onSelect(aspect, optionId)}
      className="gap-2"
    >
      <span className="min-w-0 truncate" style={style}>
        {children}
      </span>
      {!installed ? (
        <span className="text-2xs text-muted-foreground">not installed</span>
      ) : null}
      <Icon
        name="Check"
        className={cn(
          "ml-auto",
          !active && "opacity-0",
          COARSE_POINTER_ICON_SIZE_CLASS,
        )}
      />
    </DropdownMenuItem>
  );
}

function optionLabel(preferences: FontPreferences, aspect: FontAspect): string {
  const id = preferences[aspect];
  if (id === INHERIT_FONT) return "Same as interface";
  if (id === CUSTOM_FONT) return preferences.custom[aspect]?.trim() || "Custom";
  return FONT_OPTIONS.find((option) => option.id === id)?.label ?? id;
}

export function FontSettings() {
  const [preferences, setPreferences] =
    useState<FontPreferences>(readFontPreferences);
  const [customEditing, setCustomEditing] = useState<FontAspect | null>(null);
  const selectedRef = useRef(false);

  useEffect(() => {
    applyFontPreferences(preferences);
    writeFontPreferences(preferences);
  }, [preferences]);

  const installed = useMemo(
    () =>
      new Map(
        FONT_OPTIONS.map((option) => [
          option.id,
          option.probe === undefined ? true : isFontInstalled(option.probe),
        ]),
      ),
    [],
  );

  const preview = (aspect: FontAspect, optionId: string | null) => {
    if (optionId === null && selectedRef.current) return;
    previewFontPreference(
      preferences,
      optionId === null ? null : { aspect, optionId },
    );
  };
  const select = (aspect: FontAspect, optionId: string) => {
    selectedRef.current = true;
    if (optionId === CUSTOM_FONT) setCustomEditing(aspect);
    setPreferences((prev) => ({ ...prev, [aspect]: optionId }));
  };
  const isDefault =
    FONT_ASPECTS.every(
      (aspect) => preferences[aspect] === DEFAULT_FONT_PREFERENCES[aspect],
    ) && Object.keys(preferences.custom).length === 0;

  return (
    <div className="space-y-5">
      {FONT_ASPECTS.map((aspect) => {
        const copy = ASPECT_COPY[aspect];
        const options = FONT_OPTIONS.filter((option) =>
          option.aspects.includes(aspect),
        );
        return (
          <div key={aspect} className="space-y-2">
            <SettingsWithControl
              label={copy.label}
              description={copy.description}
            >
              <DropdownMenu
                onOpenChange={(open) => {
                  if (open) {
                    selectedRef.current = false;
                    return;
                  }
                  preview(aspect, null);
                }}
              >
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="outline"
                    size="sm"
                    className={TRIGGER_CLASS}
                    aria-label={copy.label}
                  >
                    <span className="min-w-0 truncate">
                      {optionLabel(preferences, aspect)}
                    </span>
                    <Icon
                      name="ChevronDown"
                      className="size-3.5 text-muted-foreground"
                    />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="end"
                  className="min-w-[var(--radix-dropdown-menu-trigger-width)]"
                >
                  {aspect !== "interface" && aspect !== "code" ? (
                    <FontMenuItem
                      aspect={aspect}
                      optionId={INHERIT_FONT}
                      active={preferences[aspect] === INHERIT_FONT}
                      installed
                      onPreview={preview}
                      onSelect={select}
                    >
                      Same as interface
                    </FontMenuItem>
                  ) : null}
                  {options.map((option) => (
                    <FontMenuItem
                      key={option.id}
                      aspect={aspect}
                      optionId={option.id}
                      active={preferences[aspect] === option.id}
                      installed={installed.get(option.id) ?? true}
                      onPreview={preview}
                      onSelect={select}
                      style={{ fontFamily: option.family }}
                    >
                      {option.label}
                    </FontMenuItem>
                  ))}
                  <DropdownMenuSeparator />
                  <FontMenuItem
                    aspect={aspect}
                    optionId={CUSTOM_FONT}
                    active={preferences[aspect] === CUSTOM_FONT}
                    installed
                    onPreview={preview}
                    onSelect={select}
                  >
                    Custom font…
                  </FontMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </SettingsWithControl>
            {preferences[aspect] === CUSTOM_FONT ? (
              <Input
                autoFocus={customEditing === aspect}
                aria-label={`${copy.label} custom family`}
                placeholder="Font family name, as installed on this machine"
                className="h-7 text-xs"
                value={preferences.custom[aspect] ?? ""}
                onChange={(event) =>
                  setPreferences((prev) => ({
                    ...prev,
                    custom: { ...prev.custom, [aspect]: event.target.value },
                  }))
                }
                onBlur={() => setCustomEditing(null)}
              />
            ) : null}
            <p
              className="truncate rounded-md border border-border/60 bg-card px-3 py-2 text-sm text-foreground"
              style={{
                fontFamily: `var(${ASPECT_PROPERTY_FOR_SAMPLE[aspect]})`,
              }}
              aria-hidden
            >
              {copy.sample}
            </p>
          </div>
        );
      })}
      <div className="flex justify-end">
        <Button
          variant="ghost"
          size="sm"
          disabled={isDefault}
          onClick={() => setPreferences(DEFAULT_FONT_PREFERENCES)}
        >
          Reset fonts
        </Button>
      </div>
    </div>
  );
}

const ASPECT_PROPERTY_FOR_SAMPLE: Record<FontAspect, string> = {
  interface: "--font-sans",
  headings: "--font-heading, var(--font-sans)",
  conversation: "--font-prose, var(--font-sans)",
  code: "--font-mono",
};
