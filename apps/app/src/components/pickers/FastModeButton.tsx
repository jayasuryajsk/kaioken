import { Button } from "@kaioken/shared-ui/button";
import { Icon } from "@kaioken/shared-ui/icon";
import { cn } from "@kaioken/shared-ui/lib/utils";
import { LIST_HOVER_TRANSITION } from "@kaioken/shared-ui/motion";
import {
  OPTION_BASE_CLASS_NAME,
  OPTION_INTERACTIVE_CLASS_NAME,
  OPTION_MUTED_CLASS_NAME,
} from "@kaioken/shared-ui/option-display";

interface FastModeButtonProps {
  enabled: boolean;
  onChange: (enabled: boolean) => void;
  label?: string;
  disabled?: boolean;
  muted?: boolean;
}

export function FastModeButton({
  enabled,
  onChange,
  label = "Fast",
  disabled,
  muted,
}: FastModeButtonProps) {
  const text = `${label} mode`;
  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      aria-pressed={enabled}
      aria-label={text}
      disabled={disabled}
      onClick={() => onChange(!enabled)}
      className={cn(
        OPTION_BASE_CLASS_NAME,
        OPTION_INTERACTIVE_CLASS_NAME,
        LIST_HOVER_TRANSITION,
        muted && OPTION_MUTED_CLASS_NAME,
        "px-1.5",
        enabled && "text-foreground",
        disabled && "cursor-default disabled:opacity-100",
      )}
    >
      <Icon
        name="Zap"
        className={cn("size-3.5 shrink-0", enabled && "fill-current")}
      />
      <span className="sr-only">{text}</span>
    </Button>
  );
}
