"use client";

import type { LucideIcon } from "lucide-react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type SurfaceStateTone = "loading" | "empty" | "inaccessible";

type SurfaceStateCardProps = {
  tone: SurfaceStateTone;
  icon?: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  className?: string;
};

const toneStyles: Record<SurfaceStateTone, string> = {
  loading: "border-cyan-300/14 bg-cyan-300/[0.035]",
  empty: "border-[var(--omnix-border)] bg-[var(--omnix-surface)]",
  inaccessible: "border-amber-200/18 bg-amber-200/[0.045]",
};

export function SurfaceStateCard({
  tone,
  icon: Icon,
  title,
  description,
  action,
  className,
}: SurfaceStateCardProps) {
  const isLoading = tone === "loading";
  const StatusIcon = Icon;

  return (
    <section
      role={isLoading ? "status" : "note"}
      aria-live={isLoading ? "polite" : undefined}
      aria-atomic={isLoading ? "true" : undefined}
      aria-busy={isLoading ? "true" : undefined}
      data-surface-state={tone}
      className={cn(
        "flex flex-col items-center justify-center rounded-2xl border px-5 py-10 text-center",
        toneStyles[tone],
        className,
      )}
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/14 bg-cyan-300/[0.07] text-cyan-100">
        {isLoading ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden="true" />
        ) : StatusIcon ? (
          <StatusIcon className="h-5 w-5" aria-hidden="true" />
        ) : null}
      </div>
      <h2 className="mt-4 text-balance text-base font-semibold text-white">{title}</h2>
      <p className="mt-1 max-w-sm text-pretty text-sm leading-6 text-[var(--omnix-text-2)]">{description}</p>
      {action ? (
        <Button type="button" variant="primary" size="sm" className="mt-5 min-h-11" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </section>
  );
}
