import { cn } from "@kaioken/shared-ui/lib/utils";

export function KaiokenLogo({ className = "size-4" }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 512 512"
      aria-hidden="true"
      className={cn(className, "text-foreground")}
      fill="none"
      strokeLinecap="round"
      strokeLinejoin="round"
      strokeWidth={52}
    >
      <polyline
        points="143,389 256,297 369,389"
        stroke="currentColor"
        strokeOpacity={0.38}
      />
      <polyline
        points="143,292 256,200 369,292"
        stroke="currentColor"
        strokeOpacity={0.72}
      />
      <polyline points="143,195 256,103 369,195" stroke="#e0241b" />
    </svg>
  );
}
