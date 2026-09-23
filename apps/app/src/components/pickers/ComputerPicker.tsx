import { Icon } from "@kaioken/shared-ui/icon";
import type { FederatedServer } from "@kaioken/client-core";
import { OptionPicker, type PickerOption } from "./OptionPicker";

export const LOCAL_COMPUTER_VALUE = "__local__";

function LaptopIcon({ className }: { className?: string }) {
  return <Icon name="Laptop" className={className} aria-hidden />;
}

interface ComputerPickerProps {
  computers: readonly FederatedServer[];
  value: string | null;
  onChange: (handle: string | null) => void;
  localName?: string;
}

export function ComputerPicker({
  computers,
  value,
  onChange,
  localName = "This computer",
}: ComputerPickerProps) {
  const remotes = computers.filter((computer) => !computer.home);
  if (remotes.length === 0) return null;
  const options: PickerOption<string>[] = [
    { value: LOCAL_COMPUTER_VALUE, label: localName, icon: LaptopIcon },
    ...remotes.map((computer) => ({
      value: computer.handle,
      label: computer.name,
      icon: LaptopIcon,
      ...(computer.live
        ? {}
        : { disabled: true, disabledReason: `${computer.name} is offline` }),
    })),
  ];
  return (
    <OptionPicker
      label="Computer"
      value={value ?? LOCAL_COMPUTER_VALUE}
      options={options}
      onChange={(next) => onChange(next === LOCAL_COMPUTER_VALUE ? null : next)}
      className="shrink-0"
      muted
    />
  );
}
