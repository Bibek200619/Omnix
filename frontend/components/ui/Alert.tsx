"use client";

import { AlertCircle, CheckCircle2, Info, TriangleAlert } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type AlertVariant = "info" | "success" | "warning" | "error";

type AlertProps = {
  title?: string;
  children: ReactNode;
  variant?: AlertVariant;
  className?: string;
  announce?: boolean;
};

const styles: Record<AlertVariant, string> = {
  info: "border-cyan-300/25 bg-cyan-300/10 text-cyan-50",
  success: "border-emerald-300/25 bg-emerald-300/10 text-emerald-50",
  warning: "border-amber-300/25 bg-amber-300/10 text-amber-50",
  error: "border-rose-400/30 bg-rose-400/10 text-rose-50",
};

const icons = {
  info: Info,
  success: CheckCircle2,
  warning: TriangleAlert,
  error: AlertCircle,
};

export function Alert({
  title,
  children,
  variant = "info",
  className,
  announce = true,
}: AlertProps) {
  const Icon = icons[variant];

  return (
    <div
      className={cn(
        "flex gap-3 rounded-lg border p-3 text-sm leading-6",
        styles[variant],
        className,
      )}
      role={announce ? (variant === "error" ? "alert" : "status") : undefined}
      aria-live={announce ? (variant === "error" ? "assertive" : "polite") : undefined}
      aria-atomic={announce ? "true" : undefined}
    >
      <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0">
        {title ? <p className="font-medium text-white">{title}</p> : null}
        <div className={cn(title && "mt-1", "text-current/80")}>{children}</div>
      </div>
    </div>
  );
}
