"use client";

import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

type ToggleProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & {
  label: string;
  description?: string;
};

export function Toggle({
  label,
  description,
  className,
  checked,
  ...props
}: ToggleProps) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-[var(--omnix-border)] bg-black/20 p-4 transition hover:-translate-y-0.5 hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:shadow-[var(--omnix-glow-xs)]",
        className,
      )}
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-white">{label}</span>
        {description ? (
          <span className="mt-1 block text-sm leading-6 text-slate-500">
            {description}
          </span>
        ) : null}
      </span>
      <span
        className={cn(
          "relative h-6 w-11 shrink-0 rounded-full border transition duration-200",
          checked
            ? "border-cyan-300/50 bg-[var(--omnix-grad-cyan)] shadow-[var(--omnix-glow-xs)]"
            : "border-[var(--omnix-border)] bg-[var(--omnix-surface)]",
        )}
      >
        <span
          className={cn(
            "absolute top-1/2 h-4 w-4 -translate-y-1/2 rounded-full bg-white shadow-sm transition duration-200",
            checked ? "left-6" : "left-1",
          )}
        />
      </span>
      <input
        type="checkbox"
        {...props}
        role="switch"
        aria-checked={Boolean(checked)}
        checked={checked}
        className="sr-only"
      />
    </label>
  );
}
