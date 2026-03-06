"use client";

import { useCallback, useState } from "react";
import { FilePlus, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: "idle" | "uploading" | "done" | "error";
  preview?: string;
};

export function UploadDropzone() {
  const [items, setItems] = useState<UploadItem[]>([]);
  const supported = ["application/pdf", "text/plain", "text/markdown", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];

  const onFiles = useCallback((files: FileList | null) => {
    if (!files) return;
    const arr = Array.from(files).map((file) => ({
      id: crypto.randomUUID(),
      file,
      progress: 0,
      status: "idle" as const,
      preview: file.type === "application/pdf" || file.type.startsWith("image/") ? URL.createObjectURL(file) : undefined,
    }));
    setItems((s) => [...arr, ...s]);
    // start uploads
    arr.forEach(upload);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    onFiles(e.dataTransfer.files);
  }, [onFiles]);

  const handleChoose = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(e.target.files);
    e.currentTarget.value = "";
  }, [onFiles]);

  function upload(item: UploadItem) {
    setItems((s) => s.map((it) => it.id === item.id ? { ...it, status: "uploading" } : it));

    // use XHR to track progress
    const fd = new FormData();
    fd.append("file", item.file);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", `${process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000"}/upload`);
    xhr.withCredentials = true;

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      setItems((s) => s.map((it) => it.id === item.id ? { ...it, progress: pct } : it));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setItems((s) => s.map((it) => it.id === item.id ? { ...it, progress: 100, status: "done" } : it));
      } else {
        setItems((s) => s.map((it) => it.id === item.id ? { ...it, status: "error" } : it));
      }
    };

    xhr.onerror = () => {
      setItems((s) => s.map((it) => it.id === item.id ? { ...it, status: "error" } : it));
    };

    // attach auth from cookies (supabase) — server handles auth check
    xhr.send(fd);
  }

  return (
    <div>
      <div
        onDrop={handleDrop}
        onDragOver={(e) => e.preventDefault()}
        className="rounded-lg border border-dashed border-white/8 bg-white/[0.02] p-6 text-center"
      >
        <div className="mx-auto max-w-lg">
          <div className="flex items-center justify-center gap-3">
            <div className="flex h-12 w-12 items-center justify-center rounded-lg bg-white/[0.03] text-cyan-200">
              <FilePlus className="h-6 w-6" />
            </div>
            <div className="text-left">
              <p className="text-sm font-medium text-white">Upload documents</p>
              <p className="mt-1 text-xs text-slate-400">PDF, DOCX, TXT, Markdown supported. Drop files here or choose from disk.</p>
            </div>
          </div>

          <div className="mt-4 flex items-center justify-center gap-3">
            <label className="cursor-pointer">
              <input type="file" multiple onChange={handleChoose} className="hidden" accept=".pdf,.docx,.txt,.md,text/*,application/pdf" />
              <Button type="button">Choose files</Button>
            </label>
          </div>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {items.map((it) => (
          <div key={it.id} className="flex items-center gap-3 rounded-md border border-white/6 bg-white/[0.02] p-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-md bg-white/[0.02] text-slate-300">
              <FileText className="h-5 w-5" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-white">{it.file.name}</p>
              <p className="mt-1 text-xs text-slate-400">{Math.round(it.file.size / 1024)} KB</p>
              <div className="mt-2 h-1 w-full rounded-full bg-white/[0.03]">
                <div className={cn("h-1 rounded-full bg-cyan-300 transition-all", it.status === "error" ? "bg-rose-400" : "bg-cyan-300")} style={{ width: `${it.progress}%` }} />
              </div>
            </div>
            <div className="flex items-center gap-2">
              {it.status === "uploading" ? (
                <span className="text-xs text-slate-400">{it.progress}%</span>
              ) : it.status === "done" ? (
                <span className="text-xs text-emerald-200">Uploaded</span>
              ) : it.status === "error" ? (
                <span className="text-xs text-rose-200">Failed</span>
              ) : (
                <Button type="button" size="sm" onClick={() => upload(it)}>Upload</Button>
              )}
            </div>
            <button type="button" onClick={() => setItems((s) => s.filter((_i) => _i.id !== it.id))} className="text-slate-400 hover:text-white">
              <X className="h-4 w-4" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
