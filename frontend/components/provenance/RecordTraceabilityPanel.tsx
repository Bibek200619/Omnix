"use client";

import Link from "next/link";
import { BadgeCheck, CircleDot, ClipboardCheck, FileText, Link2, MessagesSquare, Sparkles, Target } from "lucide-react";
import { cn } from "@/lib/utils";

export type TraceabilityLinkKind =
  | "origin"
  | "evidence"
  | "decision"
  | "task"
  | "initiative"
  | "file"
  | "conversation"
  | "source";

export type TraceabilityLink = {
  kind: TraceabilityLinkKind;
  label: string;
  href?: string;
  detail?: string | null;
};

type RecordTraceabilityPanelProps = {
  origin: TraceabilityLink;
  evidence?: TraceabilityLink[];
  decisions?: TraceabilityLink[];
  tasks?: TraceabilityLink[];
  initiatives?: TraceabilityLink[];
  sources?: TraceabilityLink[];
  compact?: boolean;
  className?: string;
};

const icons = {
  origin: CircleDot,
  evidence: Link2,
  decision: BadgeCheck,
  task: ClipboardCheck,
  initiative: Target,
  file: FileText,
  conversation: MessagesSquare,
  source: Sparkles,
} satisfies Record<TraceabilityLinkKind, typeof CircleDot>;

function groupItems({
  evidence = [],
  decisions = [],
  tasks = [],
  initiatives = [],
  sources = [],
}: Pick<RecordTraceabilityPanelProps, "evidence" | "decisions" | "tasks" | "initiatives" | "sources">) {
  return [
    { label: "Evidence", items: evidence },
    { label: "Related Decisions", items: decisions },
    { label: "Related Tasks", items: tasks },
    { label: "Related Initiatives", items: initiatives },
    { label: "Sources", items: sources },
  ].filter((group) => group.items.length > 0);
}

function TraceabilityItem({ item }: { item: TraceabilityLink }) {
  const Icon = icons[item.kind];
  const content = (
    <>
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-cyan-300/10 bg-cyan-300/[0.045] text-cyan-100/65">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-xs font-semibold text-white">{item.label}</span>
        {item.detail ? <span className="mt-0.5 line-clamp-2 text-[11px] leading-5 text-[var(--omnix-text-3)]">{item.detail}</span> : null}
      </span>
    </>
  );

  if (item.href) {
    return (
      <Link
        href={item.href}
        className="flex min-h-[44px] items-start gap-2 rounded-lg border border-white/[0.06] bg-black/15 p-2 transition hover:border-cyan-300/18 hover:bg-cyan-300/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/55"
      >
        {content}
      </Link>
    );
  }

  return (
    <div className="flex min-h-[44px] items-start gap-2 rounded-lg border border-white/[0.06] bg-black/15 p-2">
      {content}
    </div>
  );
}

export function RecordTraceabilityPanel({
  origin,
  evidence = [],
  decisions = [],
  tasks = [],
  initiatives = [],
  sources = [],
  compact = false,
  className,
}: RecordTraceabilityPanelProps) {
  const groups = groupItems({ evidence, decisions, tasks, initiatives, sources });

  return (
    <section className={cn("rounded-xl border border-[var(--omnix-border)] bg-white/[0.018] p-3", className)}>
      <div className="flex items-center gap-2">
        <CircleDot className="h-3.5 w-3.5 text-cyan-100/45" />
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">Traceability</h4>
      </div>

      <div className={cn("mt-3 grid gap-2", compact ? "sm:grid-cols-1" : "sm:grid-cols-2")}>
        <TraceabilityItem item={origin} />
      </div>

      {groups.length ? (
        <div className="mt-3 grid gap-3">
          {groups.map((group) => (
            <div key={group.label}>
              <p className="mb-1.5 text-[9px] font-bold uppercase tracking-[0.16em] text-cyan-100/35">{group.label}</p>
              <div className={cn("grid gap-2", compact ? "sm:grid-cols-1" : "sm:grid-cols-2")}>
                {group.items.slice(0, 6).map((item) => (
                  <TraceabilityItem key={`${item.kind}-${item.href || item.label}`} item={item} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
