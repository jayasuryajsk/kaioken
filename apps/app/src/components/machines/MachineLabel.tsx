import type { Host } from "@bb/domain";
import { Icon } from "@bb/shared-ui/icon";
import { cn } from "@bb/shared-ui/lib/utils";
import {
  MachineProviderIcon,
  type MachineProviderPresentation,
} from "@/components/plugin/MachineProviderIcon";

export type MachineLabelHost = Pick<
  Host,
  "machineProviderId" | "name" | "type"
>;

export function MachineLabel({
  host,
  machineProvider,
  className,
  iconClassName,
  nameClassName,
}: {
  host: MachineLabelHost;
  machineProvider?: MachineProviderPresentation | null;
  className?: string;
  iconClassName?: string;
  nameClassName?: string;
}) {
  const provider =
    host.type === "ephemeral" && host.machineProviderId !== null
      ? machineProvider?.id === host.machineProviderId
        ? machineProvider
        : {
            id: host.machineProviderId,
            displayName: host.machineProviderId,
            icon: "Server",
            logoUrl: null,
          }
      : null;

  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1.5", className)}>
      {provider === null ? (
        <Icon
          name="Laptop"
          className={cn("size-3.5 shrink-0", iconClassName)}
          aria-hidden
        />
      ) : (
        <MachineProviderIcon
          provider={provider}
          className={cn("size-3.5 shrink-0", iconClassName)}
        />
      )}
      <span className={cn("min-w-0 truncate", nameClassName)}>{host.name}</span>
    </span>
  );
}
