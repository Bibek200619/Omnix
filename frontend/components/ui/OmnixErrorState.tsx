"use client";

import type { ReactNode } from "react";
import { AlertCircle, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type OmnixErrorStateProps = {
  title: string;
  message: string;
  className?: string;
  compact?: boolean;
  retryLabel?: string;
  isRetrying?: boolean;
  onRetry?: () => void;
  onDismiss?: () => void;
  children?: ReactNode;
};

export function OmnixErrorState({
  title,
  message,
  className,
  compact = false,
  retryLabel = "Retry",
  isRetrying = false,
  onRetry,
  onDismiss,
  children,
}: OmnixErrorStateProps) {
  return (
    <section
      role="alert"
      aria-live="polite"
      className={cn(
        "relative overflow-hidden rounded-xl border border-amber-200/18 bg-[linear-gradient(145deg,var(--omnix-rgba-rgba-251-191-36-0-08),var(--omnix-rgba-rgba-34-211-238-0-035)_55%,var(--omnix-rgba-rgba-0-0-0-0-18))] shadow-[inset_0_1px_0_var(--omnix-rgba-rgba-255-255-255-0-045)]",
        compact ? "p-3" : "p-4 sm:p-5",
        className,
      )}
    >
      <div className="pointer-events-none absolute -right-10 -top-12 h-32 w-32 rounded-full bg-cyan-300/10 blur-[60px]" />
      <div className={cn("relative z-10 flex gap-3", compact ? "items-start" : "items-start sm:items-center")}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-200/20 bg-amber-200/10 text-amber-100">
          <AlertCircle className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className={cn("font-semibold text-white", compact ? "text-sm" : "text-base")}>{title}</p>
          <p className={cn("mt-1 break-words text-[var(--omnix-text-2)]", compact ? "text-xs leading-5" : "text-sm leading-6")}>
            {message}
          </p>
          {children ? <div className="mt-3">{children}</div> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {onRetry ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              isLoading={isRetrying}
              leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
              onClick={onRetry}
            >
              {retryLabel}
            </Button>
          ) : null}
          {onDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/[0.035] text-white/50 transition hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
              aria-label="Dismiss error"
              title="Dismiss"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          ) : null}
        </div>
      </div>
    </section>
  );
}
