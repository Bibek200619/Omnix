"use client";

import { X } from "lucide-react";
import { DecisionCandidatePanel } from "@/components/decisions/DecisionCandidatePanel";
import type { FileData } from "@/components/files/filesPageModel";
import { Modal } from "@/components/ui/Modal";
import type {
  DecisionCandidate,
  DecisionCandidateSourceCoverage,
} from "@/lib/workspace-types";

type DocumentDecisionSuggestionsModalProps = {
  file: FileData;
  candidates: DecisionCandidate[];
  coverage: DecisionCandidateSourceCoverage | null;
  error: string | null;
  loading: boolean;
  onClose: () => void;
  onCreate: (candidate: DecisionCandidate) => void;
  onDismiss: (candidate: DecisionCandidate) => void;
  onRefresh: () => void;
  onScanMore?: () => void;
};

export function DocumentDecisionSuggestionsModal({
  file,
  candidates,
  coverage,
  error,
  loading,
  onClose,
  onCreate,
  onDismiss,
  onRefresh,
  onScanMore,
}: DocumentDecisionSuggestionsModalProps) {
  const filename = file.file_name ?? file.filename ?? "Document";

  return (
    <Modal
      isOpen
      onClose={onClose}
      title={filename}
      description="Review evidence-backed decision suggestions extracted from this document."
      backdropClassName="z-[155] items-end bg-black/70 px-3 py-4 sm:items-center"
      className="max-h-[92dvh] max-w-2xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[linear-gradient(180deg,var(--omnix-rgba-12-18-28-0-98),var(--omnix-rgba-3-6-12-0-98))] p-4 shadow-2xl sm:rounded-2xl sm:p-5"
    >
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">
            Document suggestions
          </p>
          <h3 className="mt-1 truncate text-base font-semibold text-white">{filename}</h3>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white"
          aria-label="Close document decision suggestions"
          title="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
      <DecisionCandidatePanel
        collapsed={false}
        candidates={candidates}
        loading={loading}
        error={error}
        emptyText="No evidence-backed document decisions found."
        sourceCoverage={coverage}
        sourceType="document"
        onToggle={() => undefined}
        onRefresh={onRefresh}
        onScanMore={onScanMore}
        onCreate={onCreate}
        onDismiss={onDismiss}
      />
    </Modal>
  );
}
