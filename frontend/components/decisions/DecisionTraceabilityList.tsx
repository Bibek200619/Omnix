"use client";

import Link from "next/link";
import { BadgeCheck, Calendar, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { WorkspaceDecisionStatus } from "@/lib/workspace-types";

interface DecisionPreview {
  id: string;
  title: string;
  status: WorkspaceDecisionStatus;
  decision_reason?: string | null;
  created_at?: string | null;
}

interface DecisionTraceabilityListProps {
  decisions: DecisionPreview[];
  title?: string;
}

function statusClass(status: WorkspaceDecisionStatus) {
  if (status === "accepted") return "border-emerald-300/20 bg-emerald-300/10 text-emerald-300";
  if (status === "rejected") return "border-rose-300/20 bg-rose-300/10 text-rose-100";
  if (status === "superseded") return "border-amber-300/20 bg-amber-300/10 text-amber-300";
  return "border-cyan-300/20 bg-cyan-300/10 text-cyan-100";
}

function readableDate(value?: string | null) {
  if (!value) return "Recently";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date);
}

export function DecisionTraceabilityList({ decisions, title = "Linked Decisions" }: DecisionTraceabilityListProps) {
  if (!decisions || decisions.length === 0) return null;

  return (
    <div className="mt-4 space-y-3">
      <div className="flex items-center gap-2">
        <BadgeCheck className="h-3.5 w-3.5 text-cyan-100/40" />
        <h4 className="text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">{title}</h4>
      </div>
      <div className="grid gap-2">
        {decisions.map((decision) => (
          <Link
            key={decision.id}
            href={`/decisions?id=${decision.id}`}
            className="group block rounded-xl border border-[var(--omnix-border)] bg-black/20 p-3 transition hover:bg-white/[0.02]"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-white group-hover:text-cyan-100 transition-colors">{decision.title}</p>
                <div className="mt-2 flex items-center gap-3">
                  <span className={cn("rounded-full border px-2 py-0.5 text-[9px] font-bold uppercase tracking-tighter", statusClass(decision.status))}>
                    {decision.status}
                  </span>
                  <div className="flex items-center gap-1 text-[10px] text-[var(--omnix-text-3)]">
                    <Calendar className="h-3 w-3" />
                    {readableDate(decision.created_at)}
                  </div>
                </div>
              </div>
            </div>
            {decision.decision_reason && (
              <div className="mt-2.5 flex items-start gap-2 rounded-lg bg-white/[0.03] p-2">
                <Info className="mt-0.5 h-3 w-3 shrink-0 text-cyan-100/40" />
                <p className="text-[11px] leading-relaxed text-[var(--omnix-text-2)] italic line-clamp-2 group-hover:line-clamp-none transition-all">
                  {decision.decision_reason}
                </p>
              </div>
            )}
          </Link>
        ))}
      </div>
    </div>
  );
}
