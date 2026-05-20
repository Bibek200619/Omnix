"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Database, FileText } from "lucide-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/lib/workspace-context";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { workspaceRoleLabel } from "@/lib/workspace-roles";

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
  const { activeWorkspace, activeMembers, activeWorkspaceId } = useWorkspace();
  const [files, setFiles] = useState<FileData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const workspaceMembers = activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? [];

  const loadFiles = useCallback(async () => {
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
  }, []);

  useEffect(() => {
    void loadFiles();
  }, [activeWorkspaceId, loadFiles]);

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
    <section className="omnix-scrollbar h-full w-full overflow-y-auto px-5 py-6 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 pb-12">
      <div className="relative overflow-hidden rounded-2xl border border-[var(--omnix-border)] bg-[rgba(10,14,26,0.5)] p-5 backdrop-blur-md sm:flex sm:items-center sm:justify-between">
        <div className="pointer-events-none absolute right-0 top-0 h-56 w-56 rounded-full bg-[var(--omnix-cyan)] opacity-10 blur-[70px]" />
        <div>
          <h1 className="omnix-display flex items-center gap-2 text-xl font-semibold text-white">
            <Database className="h-5 w-5 text-[var(--omnix-cyan)]" />
            {activeWorkspace?.name ?? "Workspace"} files
          </h1>
          <p className="mt-1 text-sm text-[var(--omnix-text-2)]">
            {activeWorkspace?.is_shared
              ? "Shared documents are available to every workspace member."
              : "Upload documents to your workspace. Supported: PDF, DOCX, TXT, Markdown."}
          </p>
        </div>
        {activeWorkspace ? (
          <div className="flex items-center gap-3">
            <WorkspaceMemberStack members={workspaceMembers} totalCount={activeWorkspace.member_count} size="md" />
            <div className="text-right text-xs text-slate-400">
              <div>{activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? "member" : "members"}</div>
              <div>{workspaceRoleLabel(activeWorkspace.current_user_role)}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="rounded-2xl border border-[var(--omnix-border)] bg-[rgba(6,8,16,0.6)] p-4 backdrop-blur-xl">
        <UploadDropzone />
      </div>

      <div className="rounded-2xl border border-[var(--omnix-border)] bg-[rgba(6,8,16,0.6)] p-5 backdrop-blur-xl">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
          <FileText className="h-4 w-4 text-cyan-200" />
          {activeWorkspace?.is_shared ? "Shared files" : "Workspace files"}
        </h2>
        {loading ? (
          <p className="mt-4 text-[var(--omnix-text-2)]">Loading...</p>
        ) : error ? (
          <p className="mt-4 text-rose-300">{error}</p>
        ) : files.length === 0 ? (
          <p className="mt-4 rounded-lg border border-dashed border-[var(--omnix-border)] p-5 text-sm text-[var(--omnix-text-2)]">No files uploaded yet.</p>
        ) : (
          <div className="mt-3 space-y-2">
            {files.map((f) => (
              <div key={f.id} className="omnix-card-hover flex items-center justify-between rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)] p-3">
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
      </div>
    </section>
  );
}
