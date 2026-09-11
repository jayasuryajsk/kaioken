import type { ReasoningLevel } from "@kaioken/domain";
import { OptionPicker, type PickerOption } from "./OptionPicker";

interface ReasoningPickerProps {
  value: ReasoningLevel;
  options: readonly PickerOption<ReasoningLevel>[];
  onChange: (value: ReasoningLevel) => void;
  disabled?: boolean;
  muted?: boolean;
}

export function ReasoningPicker({
  value,
  options,
  onChange,
  disabled,
  muted,
}: ReasoningPickerProps) {
  if (options.length === 0) {
    return null;
  }
  return (
    <OptionPicker
      label="Reasoning"
      value={value}
      options={options}
      onChange={onChange}
      disabled={disabled}
      muted={muted}
      contentClassName="min-w-40"
    />
  );
}
