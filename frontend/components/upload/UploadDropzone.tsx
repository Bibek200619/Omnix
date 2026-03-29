"use client";

import { useCallback, useRef, useState } from "react";
import { FilePlus, X, FileText } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";
import { motion, AnimatePresence } from "framer-motion";
import { supabase } from "@/lib/supabase";
import type { MessageAttachment } from "@/components/chat/types";


type UploadDropzoneProps = {
  conversationId?: string;
  compact?: boolean;
  onUploadSuccess?: (file: MessageAttachment) => void;
  onUploadComplete?: (result: { hasSuccess: boolean }) => void;
};

type UploadItem = {
  id: string;
  file: File;
  progress: number;
  status: "idle" | "uploading" | "done" | "error";
  preview?: string;
};

export function UploadDropzone({ conversationId, compact = false, onUploadSuccess, onUploadComplete }: UploadDropzoneProps = {}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [isDragActive, setIsDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const activeUploadsRef = useRef(0);
  const batchHadSuccessRef = useRef(false);

  const markUploadSettled = useCallback((success: boolean) => {
    if (success) {
      batchHadSuccessRef.current = true;
    }
    activeUploadsRef.current = Math.max(0, activeUploadsRef.current - 1);
    if (activeUploadsRef.current === 0) {
      onUploadComplete?.({ hasSuccess: batchHadSuccessRef.current });
      batchHadSuccessRef.current = false;
    }
  }, [onUploadComplete]);

  const upload = useCallback(async (item: UploadItem) => {
    console.debug("[upload] starting upload", { fileName: item.file.name, conversationId });
    setItems((s) => s.map((it) => it.id === item.id ? { ...it, status: "uploading" } : it));

    const fd = new FormData();
    fd.append("file", item.file);
    if (conversationId) {
      fd.append("conversation_id", conversationId);
    }


    const xhr = new XMLHttpRequest();
    xhr.open("POST", (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:8000") + "/upload");

    xhr.upload.onprogress = (ev) => {
      if (!ev.lengthComputable) return;
      const pct = Math.round((ev.loaded / ev.total) * 100);
      setItems((s) => s.map((it) => it.id === item.id ? { ...it, progress: pct } : it));
    };

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setItems((s) => s.map((it) => it.id === item.id ? { ...it, progress: 100, status: "done" } : it));
        try {
          const uploaded = JSON.parse(xhr.responseText) as MessageAttachment;
          if (uploaded?.id) {
            console.debug("[upload] upload success", { fileId: uploaded.id, conversationId });
            onUploadSuccess?.(uploaded);
          }
        } catch (err) {
          console.error("Unable to parse upload response", err);
        }
      } else {
        console.debug("[upload] upload failed", { fileName: item.file.name, status: xhr.status });
        setItems((s) => s.map((it) => it.id === item.id ? { ...it, status: "error" } : it));
      }
      markUploadSettled(xhr.status >= 200 && xhr.status < 300);
    };

    xhr.onerror = () => {
      console.debug("[upload] upload network error", { fileName: item.file.name });
      setItems((s) => s.map((it) => it.id === item.id ? { ...it, status: "error" } : it));
      markUploadSettled(false);
    };

    try {
      if (supabase) {
        const { data, error } = await supabase.auth.getSession();
        if (error) {
          console.error("Unable to read Supabase session", error);
        }
        const token = data?.session?.access_token ?? null;
        if (token) {
          xhr.setRequestHeader("Authorization", "Bearer " + token);
        }
      }

      if (typeof window !== "undefined") {
        const activeWorkspace = window.localStorage.getItem("omnix.activeWorkspaceId");
        if (activeWorkspace) {
          xhr.setRequestHeader("X-Omnix-Workspace", activeWorkspace);
        }
      }
    } catch (err) {
      console.error("Failed to attach auth token to upload request", err);
    }

    xhr.send(fd);
  }, [conversationId, markUploadSettled, onUploadSuccess]);

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
    if (activeUploadsRef.current === 0) {
      batchHadSuccessRef.current = false;
    }
    activeUploadsRef.current += arr.length;
    arr.forEach((it) => {
      void upload(it);
    });
  }, [upload]);

  const handleDragEnter = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isDragActive) {
      setIsDragActive(true);
    }
  }, [isDragActive]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
    onFiles(e.dataTransfer.files);
  }, [onFiles]);

  const handleChoose = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onFiles(e.target.files);
    e.currentTarget.value = "";
  }, [onFiles]);

  const triggerFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  return (
    <div className="w-full">
      <motion.div
        onDrop={handleDrop}
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        animate={{
          borderColor: isDragActive ? "rgba(34, 211, 238, 0.5)" : "rgba(255, 255, 255, 0.08)",
          backgroundColor: isDragActive ? "rgba(34, 211, 238, 0.04)" : "rgba(255, 255, 255, 0.02)",
          scale: isDragActive ? 1.01 : 1,
        }}
        transition={{ type: "spring", stiffness: 300, damping: 20 }}
        className={cn(
          "relative overflow-hidden rounded-xl border border-dashed text-center transition-shadow hover:border-white/20",
          compact ? "p-4" : "p-8",
        )}
      >
        <div className="relative z-10 mx-auto max-w-lg">
          <div className={cn("flex items-center justify-center gap-4", compact ? "flex-row" : "flex-col sm:flex-row")}>
            <motion.div 
              animate={{ 
                scale: isDragActive ? 1.1 : 1,
                rotate: isDragActive ? 10 : 0,
                color: isDragActive ? "#22d3ee" : "#67e8f9",
                backgroundColor: isDragActive ? "rgba(34, 211, 238, 0.1)" : "rgba(255, 255, 255, 0.03)"
              }}
              transition={{ type: "spring", stiffness: 300, damping: 20 }}
              className={cn("flex shrink-0 items-center justify-center rounded-xl", compact ? "h-10 w-10" : "h-14 w-14")}
            >
              <FilePlus className={cn(compact ? "h-5 w-5" : "h-7 w-7")} />
            </motion.div>
            <div className={cn("min-w-0", compact ? "text-left" : "text-center sm:text-left")}>
              <motion.p 
                animate={{ color: isDragActive ? "#fff" : "#f8fafc" }}
                className={cn("font-medium", compact ? "text-sm" : "text-base")}
              >
                {isDragActive ? "Drop files to upload" : "Upload documents"}
              </motion.p>
              <p className="mt-1 text-xs text-slate-400">
                {compact ? "PDF, DOCX, TXT, or Markdown." : "PDF, DOCX, TXT, Markdown supported. Drop files here or click to choose."}
              </p>
            </div>
          </div>

          <motion.div 
            animate={{ opacity: isDragActive ? 0 : 1, y: isDragActive ? 10 : 0 }}
            transition={{ duration: 0.2 }}
            className={cn("flex items-center justify-center", compact ? "mt-4" : "mt-6")}
          >
            <input ref={fileInputRef} type="file" multiple onChange={handleChoose} className="hidden" accept=".pdf,.docx,.txt,.md,text/*,application/pdf" />
            <Button type="button" size={compact ? "sm" : "md"} onClick={triggerFilePicker} className="shadow-sm">Choose files</Button>
          </motion.div>
        </div>
        
        <AnimatePresence>
          {isDragActive && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="pointer-events-none absolute inset-0 bg-gradient-to-tr from-cyan-500/10 via-transparent to-purple-500/10"
            />
          )}
        </AnimatePresence>
      </motion.div>

      <div className={cn("space-y-3", compact ? "mt-3" : "mt-6")}>
        <AnimatePresence>
          {items.map((it) => (
            <motion.div 
              key={it.id} 
              initial={{ opacity: 0, y: 10, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.2 } }}
              transition={{ type: "spring", stiffness: 400, damping: 25 }}
              className={cn(
                "group flex flex-col gap-4 rounded-xl border border-white/6 bg-white/[0.02] transition-colors hover:bg-white/[0.04] sm:flex-row sm:items-center",
                compact ? "p-3" : "p-4",
              )}
            >
              <div className="flex items-center gap-4 min-w-0 flex-1">
                <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-lg transition-colors", it.status === "done" ? "bg-emerald-500/10 text-emerald-400" : it.status === "error" ? "bg-rose-500/10 text-rose-400" : "bg-white/5 text-slate-300")}>
                  <FileText className="h-5 w-5" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-200 group-hover:text-white transition-colors">{it.file.name}</p>
                  <div className="mt-1.5 flex items-center gap-3">
                    <p className="text-xs text-slate-500">{Math.round(it.file.size / 1024)} KB</p>
                    {it.status === "uploading" && (
                      <div className="flex-1 h-1.5 max-w-[120px] overflow-hidden rounded-full bg-white/[0.05]">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: it.progress + "%" }}
                          transition={{ ease: "linear" }}
                          className="h-full rounded-full bg-cyan-400" 
                        />
                      </div>
                    )}
                  </div>
                </div>
              </div>
              
              <div className="flex shrink-0 items-center justify-end gap-3 mt-2 sm:mt-0">
                {it.status === "uploading" ? (
                  <span className="text-xs font-medium text-cyan-400 w-12 text-right">{it.progress}%</span>
                ) : it.status === "done" ? (
                  <motion.span initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} className="text-xs font-medium text-emerald-400">Uploaded</motion.span>
                ) : it.status === "error" ? (
                  <span className="text-xs font-medium text-rose-400">Failed</span>
                ) : (
                  <Button type="button" size="sm" variant="ghost" onClick={() => upload(it)}>Upload</Button>
                )}
                
                <button type="button" onClick={() => setItems((s) => s.filter((_i) => _i.id !== it.id))} className="rounded-md p-1.5 text-slate-500 hover:bg-white/10 hover:text-slate-300 transition-colors">
                  <X className="h-4 w-4" />
                </button>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
