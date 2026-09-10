import { cn } from "@kaioken/shared-ui/lib/utils";
import kaiokenLogoUrl from "../../../../../assets/kaioken-logo.svg";

export function KaiokenLogo({ className = "size-4" }: { className?: string }) {
  return (
    <img
      src={kaiokenLogoUrl}
      alt=""
      aria-hidden="true"
      className={cn(className, "object-contain dark:invert")}
    />
  );
}
