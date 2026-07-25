"use client";

import Link from "next/link";
import { BadgeCheck, ChevronDown, ChevronRight, Loader2, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import type { DecisionCandidate, DecisionEvidence } from "@/lib/workspace-types";

type DecisionCandidatePanelProps = {
  title?: string;
  candidates: DecisionCandidate[];
  collapsed: boolean;
  loading?: boolean;
  error?: string | null;
  emptyText?: string;
  onToggle: () => void;
  onRefresh: () => void;
  onCreate: (candidate: DecisionCandidate) => void;
  onDismiss: (candidate: DecisionCandidate) => void;
};

const confidenceStyle: Record<DecisionCandidate["confidence"], string> = {
  high: "border-emerald-300/20 bg-emerald-300/10 text-emerald-100",
  medium: "border-cyan-300/20 bg-cyan-300/10 text-cyan-100",
  low: "border-amber-300/25 bg-amber-300/10 text-amber-100",
};

function evidenceLabel(evidence: DecisionEvidence) {
  if (evidence.kind === "conversation_message") {
    return `Verified message ${evidence.message_id ?? "source"}`;
  }
  const chunk = evidence.chunk_index === null || evidence.chunk_index === undefined
    ? "Document chunk"
    : `Document chunk ${evidence.chunk_index + 1}`;
  return evidence.page ? `${chunk} · page ${evidence.page}` : chunk;
}

function evidenceHref(evidence: DecisionEvidence) {
  if (evidence.kind === "conversation_message" && evidence.channel_id) {
    return `/conversations?channel=${evidence.channel_id}`;
  }
  if (evidence.kind === "document_chunk" && evidence.file_id) {
    return `/files?id=${evidence.file_id}`;
  }
  return undefined;
}

export function DecisionCandidatePanel({
  title = "Potential Decisions",
  candidates,
  collapsed,
  loading = false,
  error = null,
  emptyText = "No evidence-backed decision candidates found.",
  onToggle,
  onRefresh,
  onCreate,
  onDismiss,
}: DecisionCandidatePanelProps) {
  return (
    <section className="rounded-xl border border-cyan-300/12 bg-cyan-300/[0.035]">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between gap-3 px-3 py-2.5 text-left"
      >
        <span className="flex min-w-0 items-center gap-2">
          {collapsed ? <ChevronRight className="h-4 w-4 text-cyan-100/60" /> : <ChevronDown className="h-4 w-4 text-cyan-100/60" />}
          <Sparkles className="h-3.5 w-3.5 text-cyan-100/70" />
          <span className="truncate text-xs font-semibold uppercase tracking-[0.14em] text-cyan-100/75">{title}</span>
        </span>
        <span className="shrink-0 rounded-full border border-white/10 px-2 py-0.5 text-[10px] text-white/50">
          {loading ? "Scanning" : `${candidates.length} found`}
        </span>
      </button>
      {!collapsed ? (
        <div className="border-t border-cyan-300/10 p-3">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <p className="text-[11px] leading-5 text-[var(--omnix-text-3)]">
              Suggestions require evidence and become decisions only after you review and submit.
            </p>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="min-h-11"
              onClick={onRefresh}
              isLoading={loading}
              leftIcon={!loading ? <Sparkles className="h-3.5 w-3.5" /> : undefined}
            >
              Scan
            </Button>
          </div>
          {loading ? (
            <div className="flex items-center gap-2 rounded-lg border border-white/10 bg-black/10 px-3 py-3 text-xs text-cyan-100/70">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Reviewing source evidence
            </div>
          ) : error ? (
            <div className="rounded-lg border border-rose-300/20 bg-rose-300/10 px-3 py-3 text-xs text-rose-100">
              {error}
            </div>
          ) : candidates.length === 0 ? (
            <div className="rounded-lg border border-dashed border-white/10 bg-black/10 px-3 py-4 text-center text-xs text-[var(--omnix-text-3)]">
              {emptyText}
            </div>
          ) : (
            <div className="space-y-2">
              {candidates.map((candidate) => (
                <article key={candidate.id} className="rounded-lg border border-white/10 bg-black/15 p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <h3 className="break-words text-sm font-semibold text-white">{candidate.title}</h3>
                      <p className="mt-1 text-xs leading-5 text-[var(--omnix-text-2)]">{candidate.reason}</p>
                    </div>
                    <span className={cn("shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider", confidenceStyle[candidate.confidence])}>
                      {candidate.confidence === "low" ? "Low confidence suggestion" : candidate.confidence}
                    </span>
                  </div>
                  <div className="mt-3 space-y-1.5">
                    {candidate.supporting_evidence.map((evidence, index) => {
                      const href = evidenceHref(evidence);
                      return (
                        <div key={`${candidate.id}-${index}`} className="rounded-md border border-white/7 bg-white/[0.025] px-2 py-1.5 text-[11px] leading-5 text-white/55">
                          <p>“{evidence.quote}”</p>
                          {href ? (
                            <Link href={href} className="mt-1 inline-flex text-[10px] font-semibold text-cyan-200/70 hover:text-cyan-100">
                              {evidenceLabel(evidence)}
                            </Link>
                          ) : (
                            <span className="mt-1 inline-flex text-[10px] font-semibold text-cyan-200/55">{evidenceLabel(evidence)}</span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="mt-3 flex flex-wrap justify-end gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="min-h-11"
                      onClick={() => onDismiss(candidate)}
                      leftIcon={<X className="h-3.5 w-3.5" />}
                    >
                      Dismiss
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className="min-h-11"
                      onClick={() => onCreate(candidate)}
                      leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}
                    >
                      Create Decision
                    </Button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
      ) : null}
    </section>
  );
}
