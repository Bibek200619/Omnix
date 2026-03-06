"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/Button";

const UploadDropzone = dynamic(() => import("@/components/upload/UploadDropzone").then((m) => m.UploadDropzone), { ssr: false });

export default function FilesPage() {
  const [files, setFiles] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadFiles() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<any[]>("/files");
      setFiles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFiles();
  }, []);

  async function handleDelete(id: string) {
    try {
      await apiClient.request(`/files/${id}`, { method: "DELETE" });
      setFiles((s) => s.filter((f) => f.id !== id));
    } catch (err) {
      console.error(err);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <section className="flex min-h-[calc(100vh-8rem)] flex-col gap-4">
      <h1 className="text-lg font-semibold text-white">Workspace files</h1>
      <p className="text-sm text-slate-400">Upload documents to your workspace. Supported: PDF, DOCX, TXT, Markdown.</p>

      <div className="mt-4">
        <UploadDropzone />
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium text-white">Your files</h2>
        {loading ? (
          <p className="text-slate-400">Loading...</p>
        ) : error ? (
          <p className="text-rose-300">{error}</p>
        ) : files.length === 0 ? (
          <p className="text-slate-400">No files uploaded yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {files.map((f) => (
              <div key={f.id} className="flex items-center justify-between rounded-md border border-white/6 bg-white/[0.02] p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-white">{f.file_name ?? f.filename}</p>
                  <p className="mt-1 text-xs text-slate-400">{f.file_type ?? f.content_type} • {f.size_bytes} bytes</p>
                </div>
                <div className="flex items-center gap-2">
                  <a href={f.storage_path} target="_blank" rel="noreferrer" className="text-slate-400 hover:text-white">Download</a>
                  <Button type="button" size="sm" variant="ghost" onClick={() => handleDelete(f.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
