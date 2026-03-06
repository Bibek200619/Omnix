"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/Button";

const UploadDropzone = dynamic(() => import("@/components/upload/UploadDropzone").then((m) => m.UploadDropzone), { ssr: false });


interface FileData {
  id: string;
  file_name?: string;
  filename?: string;
  file_type?: string;
  content_type?: string;
  size_bytes?: number;
  storage_path?: string;
}

export default function FilesPage() {
  const [files, setFiles] = useState<FileData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadFiles() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<FileData[]>("/files");
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

  async function handleDownload(id: string, filename: string) {
    try {
      const response = await apiClient.request(`/files/${id}/download`);
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      document.body.removeChild(a);
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
                  <Button type="button" size="sm" variant="ghost" onClick={() => handleDownload(f.id, f.file_name ?? f.filename ?? "download")}>Download</Button>
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
