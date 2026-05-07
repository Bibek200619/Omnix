"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/lib/workspace-context";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";

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
    <section className="flex min-h-[calc(100vh-8rem)] flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-lg border border-white/10 bg-white/[0.04] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-lg font-semibold text-white">
            {activeWorkspace?.name ?? "Workspace"} files
          </h1>
          <p className="text-sm text-slate-400">
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
              <div>{activeWorkspace.current_user_role === "owner" ? "Owner" : "Member"}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="mt-4">
        <UploadDropzone />
      </div>

      <div className="mt-6">
        <h2 className="text-sm font-medium text-white">
          {activeWorkspace?.is_shared ? "Shared files" : "Workspace files"}
        </h2>
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
