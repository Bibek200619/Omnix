"use client";

import { BadgeCheck, CircleDot, User, Calendar, MessageSquare } from "lucide-react";
import { WorkspaceDecision } from "@/lib/workspace-types";
import { DecisionLifecycleControls } from "./DecisionLifecycleControls";
import { DecisionTaskLinker } from "./DecisionTaskLinker";
import { DecisionInitiativeLinker } from "./DecisionInitiativeLinker";

interface DecisionContextPanelProps {
  decision: WorkspaceDecision;
  onUpdate: (updated: WorkspaceDecision) => void;
}

function readableDate(value?: string | null) {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function creatorLabel(decision: WorkspaceDecision) {
  return decision.creator_name || decision.creator_email || decision.created_by;
}

export function DecisionContextPanel({ decision, onUpdate }: DecisionContextPanelProps) {
  return (
    <div className="omnix-scrollbar h-full overflow-y-auto p-4 sm:p-5">
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        {/* Main Content: Overview & Provenance */}
        <div className="space-y-6">
          <section className="rounded-xl border border-[var(--omnix-border)] bg-black/20 p-5">
            <div className="mb-4 flex items-center justify-between">
              <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">
                <BadgeCheck className="h-3.5 w-3.5 text-cyan-100/60" />
                Decision Overview
              </p>
              <DecisionLifecycleControls decision={decision} onUpdate={onUpdate} />
            </div>
            
            <h3 className="text-lg font-semibold text-white">{decision.title}</h3>
            
            <div className="mt-4 space-y-4">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--omnix-text-3)]">Reason</p>
                <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--omnix-text)]">
                  {decision.decision_reason || "No reason recorded."}
                </p>
              </div>
              
              {decision.description && (
                <div className="border-t border-[var(--omnix-border)] pt-4">
                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--omnix-text-3)]">Description</p>
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-[var(--omnix-text-2)]">
                    {decision.description}
                  </p>
                </div>
              )}
            </div>
          </section>

          <section className="rounded-xl border border-[var(--omnix-border)] bg-white/[0.02] p-5">
            <p className="mb-4 flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">
              <CircleDot className="h-3.5 w-3.5 text-cyan-100/60" />
              Provenance
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-cyan-300/10 p-1.5">
                  <User className="h-3.5 w-3.5 text-cyan-100/60" />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-[var(--omnix-text-3)] uppercase tracking-tight">Recorded by</p>
                  <p className="mt-0.5 text-xs text-white">{creatorLabel(decision)}</p>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="mt-0.5 rounded-full bg-cyan-300/10 p-1.5">
                  <Calendar className="h-3.5 w-3.5 text-cyan-100/60" />
                </div>
                <div>
                  <p className="text-[10px] font-medium text-[var(--omnix-text-3)] uppercase tracking-tight">Recorded date</p>
                  <p className="mt-0.5 text-xs text-white">{readableDate(decision.created_at)}</p>
                </div>
              </div>
              {decision.source_message_id && (
                <div className="flex items-start gap-3 sm:col-span-2">
                  <div className="mt-0.5 rounded-full bg-cyan-300/10 p-1.5">
                    <MessageSquare className="h-3.5 w-3.5 text-cyan-100/60" />
                  </div>
                  <div>
                    <p className="text-[10px] font-medium text-[var(--omnix-text-3)] uppercase tracking-tight">Source</p>
                    <p className="mt-0.5 text-xs text-cyan-100/80">Conversation message extraction</p>
                  </div>
                </div>
              )}
            </div>
          </section>
        </div>

        {/* Sidebar: Impact & Linkages */}
        <aside className="space-y-6">
          <section className="rounded-xl border border-[var(--omnix-border)] bg-cyan-300/[0.02] p-5 shadow-[inset_0_1px_1px_rgba(255,255,255,0.01)]">
            <DecisionInitiativeLinker decision={decision} onUpdate={onUpdate} />
          </section>

          <section className="rounded-xl border border-[var(--omnix-border)] bg-black/10 p-5">
            <DecisionTaskLinker decision={decision} onUpdate={onUpdate} />
          </section>
        </aside>
      </div>
    </div>
  );
}
