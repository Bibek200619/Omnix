"use client";

import { Activity, AlertTriangle, CheckCircle2, RefreshCw, ServerCog } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  fileIngestionStatus,
  fileStatusLabel,
  fileStatusStyle,
  statusLabel,
  statusStyle,
  type FileData,
  type WorkspaceConnector,
} from "@/components/files/filesPageModel";

type SourceHealthConsoleProps = {
  files: FileData[];
  connectors: WorkspaceConnector[];
  actionConnectorId?: string | null;
  onRetryConnector: (connector: WorkspaceConnector) => void;
};

function statusCount(files: FileData[], statuses: string[]) {
  return files.filter((file) => statuses.includes(fileIngestionStatus(file))).length;
}

export function SourceHealthConsole({
  files,
  connectors,
  actionConnectorId,
  onRetryConnector,
}: SourceHealthConsoleProps) {
  const searchableCount = statusCount(files, ["searchable", "embedded", "ocr_complete"]);
  const activeCount = statusCount(files, ["uploaded", "queued", "processing", "extracting", "extracted", "chunking", "chunked", "embedding", "ocr_running"]);
  const attentionFiles = files.filter((file) => ["failed", "extraction_failed", "ocr_required", "partially_searchable"].includes(fileIngestionStatus(file)));
  const failedConnectors = connectors.filter((connector) => connector.status === "failed" || connector.status === "needs_authentication");
  const healthyConnectorCount = connectors.filter((connector) => connector.status === "live" || connector.status === "connected").length;
  const needsAttention = attentionFiles.length + failedConnectors.length;

  return (
    <section className="omnix-cinematic-card p-5" data-source-health-console>
      <div className="relative z-10 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-cyan-100/50">
            <ServerCog className="h-3.5 w-3.5" />
            Ingestion console
          </p>
          <h2 className="mt-1 text-sm font-semibold text-white">Source health and recovery</h2>
          <p className="mt-1 max-w-2xl text-xs leading-5 text-[var(--omnix-text-3)]">
            File extraction, embedding, connector jobs, and recoverable source failures are visible here.
          </p>
        </div>
        <span className={cn("inline-flex min-h-8 w-fit items-center rounded-full border px-3 text-xs font-semibold", needsAttention ? "border-amber-300/25 bg-amber-300/10 text-amber-100" : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100")}>
          {needsAttention ? `${needsAttention} need attention` : "Healthy"}
        </span>
      </div>

      <div className="relative z-10 mt-4 grid gap-2 sm:grid-cols-4">
        {[
          { label: "Searchable files", value: searchableCount, icon: CheckCircle2 },
          { label: "Processing files", value: activeCount, icon: Activity },
          { label: "Healthy connectors", value: healthyConnectorCount, icon: ServerCog },
          { label: "Failures", value: needsAttention, icon: AlertTriangle },
        ].map((metric) => {
          const Icon = metric.icon;
          return (
            <div key={metric.label} className="rounded-xl border border-white/[0.06] bg-black/15 p-3">
              <Icon className="h-4 w-4 text-cyan-100/45" />
              <p className="mt-2 text-xl font-semibold text-white">{metric.value}</p>
              <p className="text-[11px] text-[var(--omnix-text-3)]">{metric.label}</p>
            </div>
          );
        })}
      </div>

      {needsAttention ? (
        <div className="relative z-10 mt-4 grid gap-2">
          {attentionFiles.slice(0, 3).map((file) => {
            const status = fileIngestionStatus(file);
            return (
              <div key={file.id} className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-white">{file.file_name ?? file.filename ?? "Workspace file"}</p>
                  <p className="mt-1 text-[11px] text-[var(--omnix-text-3)]">Job {file.processing_job_id ?? "not reported"}</p>
                </div>
                <span className={cn("w-fit rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider", fileStatusStyle[status])}>
                  {fileStatusLabel[status]}
                </span>
              </div>
            );
          })}
          {failedConnectors.slice(0, 3).map((connector) => (
            <div key={connector.id} className="flex flex-col gap-2 rounded-xl border border-white/[0.06] bg-black/15 p-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-white">{connector.display_name}</p>
                <p className="mt-1 text-[11px] text-[var(--omnix-text-3)]">Job {connector.job?.id ?? connector.job_id ?? "not reported"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <span className={cn("rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider", statusStyle[connector.status])}>
                  {statusLabel[connector.status]}
                </span>
                {connector.status === "failed" ? (
                  <Button type="button" size="sm" variant="ghost" className="min-h-11" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} isLoading={actionConnectorId === connector.id} onClick={() => onRetryConnector(connector)}>
                    Retry
                  </Button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
