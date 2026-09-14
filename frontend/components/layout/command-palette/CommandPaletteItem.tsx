"use client";

import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { PaletteItem } from "./commandPaletteModel";

type CommandPaletteItemProps = {
  active: boolean;
  item: PaletteItem;
  onActivate: () => void;
  onActiveChange: () => void;
  setItemRef: (node: HTMLButtonElement | null) => void;
};

export function CommandPaletteItem({
  active,
  item,
  onActivate,
  onActiveChange,
  setItemRef,
}: CommandPaletteItemProps) {
  const Icon = item.icon;

  return (
    <button
      ref={setItemRef}
      type="button"
      onMouseEnter={onActiveChange}
      onFocus={onActiveChange}
      onClick={onActivate}
      aria-current={active ? "true" : undefined}
      aria-label={`${item.label}. ${item.description}`}
      className={cn(
        "group flex min-h-[4.25rem] w-full items-center gap-3 rounded-xl border px-3 py-3 text-left transition active:scale-[0.995] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55 sm:min-h-[3.9rem] sm:py-2.5",
        active
          ? "border-cyan-300/35 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-xs)]"
          : "border-transparent bg-white/[0.018] hover:border-cyan-300/18 hover:bg-white/[0.04]",
      )}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-cyan-300/10 bg-cyan-300/[0.045] text-cyan-100/70">
        <Icon aria-hidden="true" className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-sm font-semibold text-white">{item.label}</span>
          {item.kind === "search" ? (
            <span className="shrink-0 rounded-md border border-white/8 bg-white/[0.04] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.1em] text-white/35">
              Search
            </span>
          ) : null}
        </span>
        <span className="mt-1 line-clamp-2 text-xs leading-5 text-[var(--omnix-text-2)]">
          {item.description}
        </span>
      </span>
      <ArrowUpRight aria-hidden="true" className="h-4 w-4 shrink-0 text-white/25 transition group-hover:text-cyan-100/70" />
    </button>
  );
}
