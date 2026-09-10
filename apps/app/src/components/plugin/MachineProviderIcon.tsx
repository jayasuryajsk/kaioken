import { Icon } from "@bb/shared-ui/icon";
import { getProviderIconInfo } from "@/lib/provider-icon";
import { pluginIconName } from "./PluginIcon";

export interface MachineProviderPresentation {
  id: string;
  displayName: string;
  icon: string;
  logoUrl: string | null;
}

export function MachineProviderIcon({
  provider,
  className,
}: {
  provider: MachineProviderPresentation;
  className?: string;
}) {
  const info = getProviderIconInfo(provider.id, {
    logoUrl: provider.logoUrl,
    displayName: provider.displayName,
    icon: { glyph: provider.icon },
  });
  const ProviderIcon = info?.icon;
  return ProviderIcon === undefined ? (
    <Icon name={pluginIconName(provider.icon)} className={className} />
  ) : (
    <ProviderIcon className={className} />
  );
}

export function MachineProviderKind({
  provider,
  className,
}: {
  provider: MachineProviderPresentation;
  className?: string;
}) {
  return (
    <span className={className}>
      <MachineProviderIcon provider={provider} className="size-3 shrink-0" />
      <span className="min-w-0 truncate">{provider.displayName}</span>
    </span>
  );
}
