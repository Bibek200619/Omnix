import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type BadgeVariant = "default" | "success" | "warning" | "error" | "info" | "role";

type BadgeProps = {
  variant?: BadgeVariant;
  children: ReactNode;
  className?: string;
};

const variantClasses: Record<BadgeVariant, string> = {
  default: "border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-[var(--omnix-text-2)]",
  success: "omnix-status-synced",
  warning: "border-amber-300/25 bg-amber-400/10 text-amber-200",
  error: "omnix-status-error",
  info: "omnix-status-syncing",
  role: "",
};

export function Badge({ variant = "default", children, className }: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
        variantClasses[variant],
        className,
      )}
    >
      {children}
    </span>
  );
}
