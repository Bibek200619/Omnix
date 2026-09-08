"use client";

import { BadgeCheck, CircleDot, User, Calendar, MessageSquare } from "lucide-react";
import { WorkspaceDecision } from "@/lib/workspace-types";
import { MentionText } from "@/components/mentions/MentionText";
import { DecisionGraphSummary, type DecisionGraphNode } from "@/components/provenance/DecisionGraphSummary";
import { RecordTraceabilityPanel } from "@/components/provenance/RecordTraceabilityPanel";
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

function decisionOrigin(decision: WorkspaceDecision) {
  if (decision.source_message_id) {
    return {
      kind: "origin" as const,
      label: "Conversation-derived decision",
      href: decision.source_channel_id ? `/conversations?channel=${decision.source_channel_id}` : "/conversations",
      detail: `Source message ${decision.source_message_id}`,
    };
  }
  if (decision.source_type === "document" && decision.source_id) {
    return {
      kind: "origin" as const,
      label: "Document-derived decision",
      href: `/files?id=${decision.source_id}`,
      detail: `Source document ${decision.source_id}`,
    };
  }
  if (decision.source_type === "conversation" && decision.source_id) {
    return {
      kind: "origin" as const,
      label: "Conversation-derived decision",
      href: `/conversations?channel=${decision.source_id}`,
      detail: `Source conversation ${decision.source_id}`,
    };
  }
  return {
    kind: "origin" as const,
    label: "Recorded decision",
    detail: `Authority: ${creatorLabel(decision)}`,
  };
}

export function DecisionContextPanel({ decision, onUpdate }: DecisionContextPanelProps) {
  const firstLinkedTask = decision.linked_tasks[0];
  const traceabilityTasks = decision.linked_tasks.map((task) => ({
    kind: "task" as const,
    label: task.title,
    href: `/tasks?id=${task.id}`,
    detail: task.status,
  }));
  const traceabilityInitiatives = decision.initiative
    ? [{
        kind: "initiative" as const,
        label: decision.initiative.title,
        href: `/initiatives?id=${decision.initiative.id}`,
        detail: decision.initiative.status,
      }]
    : [];
  const verifiedEvidence = decision.source_evidence ?? [];
  const traceabilityEvidence = verifiedEvidence.length > 0
    ? verifiedEvidence.map((evidence) => {
        const isConversation = evidence.kind === "conversation_message";
        const chunkLabel = evidence.chunk_index === null || evidence.chunk_index === undefined
          ? "Document chunk"
          : `Document chunk ${evidence.chunk_index + 1}`;
        return {
          kind: isConversation ? "conversation" as const : "file" as const,
          label: isConversation
            ? `Verified message ${evidence.message_id ?? "source"}`
            : evidence.page ? `${chunkLabel} · page ${evidence.page}` : chunkLabel,
          href: isConversation
            ? (evidence.channel_id ? `/conversations?channel=${evidence.channel_id}` : "/conversations")
            : (evidence.file_id ? `/files?id=${evidence.file_id}` : undefined),
          detail: `“${evidence.quote}”`,
        };
      })
    : decision.source_message_id
    ? [{
        kind: "conversation" as const,
        label: "Source conversation",
        href: decision.source_channel_id ? `/conversations?channel=${decision.source_channel_id}` : "/conversations",
        detail: decision.decision_reason || "Decision extracted from workspace conversation context",
      }]
    : decision.source_type === "document" && decision.source_id
      ? [{
          kind: "file" as const,
          label: "Source document",
          href: `/files?id=${decision.source_id}`,
          detail: decision.decision_reason || "Decision extracted from document evidence",
        }]
      : decision.source_type === "conversation" && decision.source_id
        ? [{
            kind: "conversation" as const,
            label: "Source conversation",
            href: `/conversations?channel=${decision.source_id}`,
            detail: decision.decision_reason || "Decision extracted from conversation evidence",
          }]
    : decision.decision_reason
      ? [{
          kind: "evidence" as const,
          label: "Primary rationale",
          detail: decision.decision_reason,
        }]
      : [];
  const graphSourceTitle =
    decision.source_type === "document"
      ? "Document source"
      : decision.source_message_id || decision.source_type === "conversation"
        ? "Conversation source"
        : decision.initiative
          ? "Initiative context"
          : "Manual record";
  const graphSourceHref =
    decision.source_type === "document" && decision.source_id
      ? `/files?id=${decision.source_id}`
      : decision.source_channel_id || (decision.source_type === "conversation" && decision.source_id)
        ? `/conversations?channel=${decision.source_channel_id || decision.source_id}`
        : undefined;
  const decisionGraphNodes: DecisionGraphNode[] = [
    {
      kind: "task",
      title: firstLinkedTask ? `${decision.linked_tasks.length} linked task${decision.linked_tasks.length === 1 ? "" : "s"}` : "No linked tasks",
      detail: firstLinkedTask?.title ?? "Link tasks to show execution caused by this decision.",
      href: firstLinkedTask ? `/tasks?id=${firstLinkedTask.id}` : undefined,
    },
    { kind: "decision", title: decision.title, detail: decision.status },
    {
      kind: "evidence",
      title: decision.decision_reason ? "Rationale recorded" : "Rationale missing",
      detail: decision.decision_reason || "Add a reason so future teammates can inspect why this decision exists.",
    },
    {
      kind: "source",
      title: graphSourceTitle,
      detail: decision.source_id || decision.source_message_id || decision.initiative?.title || creatorLabel(decision),
      href: graphSourceHref,
    },
  ];

  return (
    <div className="omnix-container-responsive omnix-scrollbar h-full overflow-y-auto p-4 sm:p-6 xl:p-8">
      <div className="mx-auto max-w-6xl">
        <div className="omnix-decision-context-grid">
          {/* Main Content: Overview & Provenance */}
          <div className="min-w-0 space-y-6 xl:space-y-8">
            <section className="relative overflow-hidden rounded-2xl border border-[var(--omnix-border)] bg-black/40 p-4 shadow-2xl sm:p-6 xl:p-8">
              <div className="absolute -right-20 -top-20 h-64 w-64 rounded-full bg-cyan-400/5 blur-[100px]" />
              
              <div className="relative z-10">
                <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
                  <p className="flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/80">
                    <BadgeCheck className="h-4 w-4" />
                    Strategic Context
                  </p>
                  <DecisionLifecycleControls decision={decision} onUpdate={onUpdate} />
                </div>
                
                <div className="space-y-6">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">Primary Rationale</p>
                    <p className="mt-3 whitespace-pre-wrap text-base leading-relaxed text-white/90 selection:bg-cyan-400/30">
                      <MentionText
                        content={decision.decision_reason || "No explicit reason recorded for this choice."}
                        mentions={decision.mentions}
                      />
                    </p>
                  </div>
                  
                  {decision.description && (
                    <div className="border-t border-white/5 pt-6">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">Implementation Details</p>
                      <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-[var(--omnix-text-2)]">
                        <MentionText content={decision.description} mentions={decision.mentions} />
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </section>

            <section className="rounded-2xl border border-[var(--omnix-border)] bg-white/[0.01] p-4 sm:p-6 xl:p-8">
              <p className="mb-6 flex items-center gap-2.5 text-[10px] font-bold uppercase tracking-[0.2em] text-[var(--omnix-text-3)]">
                <CircleDot className="h-4 w-4 text-cyan-400/40" />
                Audit Trail & Provenance
              </p>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-400/10 shadow-[0_0_15px_var(--omnix-rgba-34-211-238-0-1)]">
                    <User className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-tight text-[var(--omnix-text-3)]">Authority</p>
                    <p className="mt-0.5 text-sm font-semibold text-white">{creatorLabel(decision)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4">
                  <div className="flex h-10 w-10 items-center justify-center rounded-full bg-cyan-400/10 shadow-[0_0_15px_var(--omnix-rgba-34-211-238-0-1)]">
                    <Calendar className="h-4 w-4 text-cyan-400" />
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-tight text-[var(--omnix-text-3)]">Recorded</p>
                    <p className="mt-0.5 text-sm font-semibold text-white">{readableDate(decision.created_at)}</p>
                  </div>
                </div>
                {decision.source_message_id && (
                  <div className="flex items-center gap-4 rounded-xl border border-white/5 bg-white/[0.02] p-4 sm:col-span-2">
                    <div className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-400/10 shadow-[0_0_15px_var(--omnix-rgba-52-211-153-0-1)]">
                      <MessageSquare className="h-4 w-4 text-emerald-400" />
                    </div>
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-tight text-[var(--omnix-text-3)]">Source Intelligence</p>
                      <p className="mt-0.5 text-sm font-medium text-emerald-400/80">Extracted from workspace conversation context</p>
                    </div>
                  </div>
                )}
              </div>
              <RecordTraceabilityPanel
                origin={decisionOrigin(decision)}
                evidence={traceabilityEvidence}
                tasks={traceabilityTasks}
                initiatives={traceabilityInitiatives}
                className="mt-6"
              />
              <DecisionGraphSummary nodes={decisionGraphNodes} className="mt-4" />
            </section>
          </div>

          {/* Sidebar: Execution & Impact */}
          <aside className="min-w-0 space-y-6 xl:space-y-8">
            <div className="space-y-2">
              <h4 className="px-2 text-[10px] font-bold uppercase tracking-[0.25em] text-cyan-400">Execution Impact</h4>
              <p className="px-2 text-[11px] text-[var(--omnix-text-3)] leading-relaxed">
                Track how this decision propagates through active initiatives and operational tasks.
              </p>
            </div>

            <section className="relative overflow-hidden rounded-2xl border border-cyan-400/20 bg-cyan-400/[0.03] p-6 shadow-lg transition-all hover:bg-cyan-400/[0.05]">
              <div className="absolute -left-10 -top-10 h-32 w-32 rounded-full bg-cyan-400/5 blur-2xl" />
              <DecisionInitiativeLinker decision={decision} onUpdate={onUpdate} />
            </section>

            <section className="rounded-2xl border border-[var(--omnix-border)] bg-white/[0.02] p-6 transition-all hover:bg-white/[0.04]">
              <DecisionTaskLinker decision={decision} onUpdate={onUpdate} />
            </section>

            <div className="rounded-xl border border-dashed border-white/10 p-4 text-center">
              <p className="text-[10px] font-medium text-[var(--omnix-text-3)] italic">
                Decisions link to tasks to ensure execution accountability.
              </p>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}
