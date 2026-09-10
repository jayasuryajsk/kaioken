import { COARSE_POINTER_COMPACT_ICON_SIZE_CLASS } from "@kaioken/shared-ui/coarse-pointer-sizing";
import { Icon } from "@kaioken/shared-ui/icon";
import { resolveRightPanelFileVisual } from "./rightPanelFileVisuals";

interface RightPanelFileTabIconProps {
  path: string;
}

export function RightPanelFileTabIcon({ path }: RightPanelFileTabIconProps) {
  const visual = resolveRightPanelFileVisual({ path });
  return (
    <Icon
      name={visual.iconName}
      className={COARSE_POINTER_COMPACT_ICON_SIZE_CLASS}
      aria-hidden
    />
  );
}
