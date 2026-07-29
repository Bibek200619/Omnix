import { BadgeCheck, Download, FileText, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import {
  fileIngestionStatus,
  fileStatusDetail,
  fileStatusLabel,
  fileStatusStyle,
  formatFileSize,
  type FileData,
} from "@/components/files/filesPageModel";

type FileSourceCardProps = {
  file: FileData;
  view: "grid" | "list";
  onScanDecisions: (file: FileData) => void;
  onDownload: (id: string, filename: string) => void;
  onDelete: (id: string) => void;
};

export function FileSourceCard({
  file,
  view,
  onScanDecisions,
  onDownload,
  onDelete,
}: FileSourceCardProps) {
  const ingestionStatus = fileIngestionStatus(file);
  const filename = file.file_name ?? file.filename ?? "download";

  return (
    <div
      className={
        view === "grid"
          ? "omnix-source-card flex min-h-[174px] flex-col justify-between gap-3 p-[18px]"
          : "omnix-source-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"
      }
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 shadow-[0_0_14px_var(--omnix-rgba-0-255-255-0-12)]">
          <FileText className="h-[19px] w-[19px]" />
        </span>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <p className="omnix-display max-w-full truncate text-[13px] font-bold text-white">
              {filename}
            </p>
            <span
              className={cn(
                "rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider",
                fileStatusStyle[ingestionStatus],
              )}
            >
              {fileStatusLabel[ingestionStatus]}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-white/35">
            {file.file_type ?? file.content_type ?? "Document"} -{" "}
            {formatFileSize(file.size_bytes)}
          </p>
          <p className="mt-2 max-w-3xl text-[11px] leading-5 text-white/50">
            {fileStatusDetail(file)}
          </p>
        </div>
      </div>
      <div
        className={
          view === "grid"
            ? "grid grid-cols-2 gap-2 border-t border-white/5 pt-3 sm:flex sm:items-center"
            : "grid grid-cols-2 gap-2 sm:flex sm:items-center"
        }
      >
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11"
          leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}
          onClick={() => onScanDecisions(file)}
        >
          Decisions
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11"
          leftIcon={<Download className="h-3.5 w-3.5" />}
          onClick={() => onDownload(file.id, filename)}
        >
          Download
        </Button>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="min-h-11 text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
          leftIcon={<Trash2 className="h-3.5 w-3.5" />}
          onClick={() => onDelete(file.id)}
        >
          Delete
        </Button>
      </div>
    </div>
  );
}
