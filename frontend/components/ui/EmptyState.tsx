"use client";

import type { LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type EmptyStateProps = {
  icon: LucideIcon;
  title: string;
  description: string;
  action?: { label: string; onClick: () => void };
  className?: string;
};

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn("omnix-section-card flex flex-col items-center justify-center px-5 py-10 text-center", className)}>
      <div className="omnix-icon-tile h-12 w-12 bg-cyan-300/[0.08] text-cyan-100">
        <Icon className="h-5 w-5" />
      </div>
      <h2 className="mt-4 text-base font-semibold text-white">{title}</h2>
      <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--omnix-text-2)]">{description}</p>
      {action ? (
        <Button type="button" variant="primary" size="sm" className="mt-5 min-h-10" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
