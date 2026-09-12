import { useAtom } from "jotai";
import {
  COMPOSE_BACKDROP_PATTERNS,
  type ComposeBackdropPattern,
} from "@kaioken/domain";
import {
  OptionPicker,
  type PickerOption,
} from "@/components/pickers/OptionPicker";
import { SettingsWithControl } from "@/components/ui/settings-section";
import { composeBackdropAtom } from "@/lib/compose-backdrop/atom";

export const COMPOSE_BACKDROP_SETTING_LABEL = "New thread backdrop";

const LABELS: Record<ComposeBackdropPattern, string> = {
  off: "Off",
  drift: "Drift",
  rain: "Rain",
  life: "Life",
  static: "Still",
};

const OPTIONS: readonly PickerOption<ComposeBackdropPattern>[] =
  COMPOSE_BACKDROP_PATTERNS.map((value) => ({ value, label: LABELS[value] }));

export function ComposeBackdropSetting() {
  const [pattern, setPattern] = useAtom(composeBackdropAtom);
  return (
    <SettingsWithControl
      label={COMPOSE_BACKDROP_SETTING_LABEL}
      description="A faint character field behind the composer on the new thread screen. Drift and Rain move slowly, Life runs Conway's game, Still is a frozen field."
    >
      <OptionPicker
        label={COMPOSE_BACKDROP_SETTING_LABEL}
        value={pattern}
        options={OPTIONS}
        onChange={setPattern}
        align="end"
        className="h-7 border border-border/60 bg-card px-2 text-xs"
      />
    </SettingsWithControl>
  );
}
