"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  BookOpen,
  ClipboardList,
  Cloud,
  Database,
  Download,
  FileText,
  FileUp,
  Github,
  Globe2,
  HardDrive,
  LayoutGrid,
  List,
  MessageSquare,
  Plus,
  Search,
  ShieldCheck,
  Ticket,
  Trash2,
} from "lucide-react";
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

function formatFileSize(size?: number) {
  if (!size) return "Unknown size";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

const connectors = [
  { name: "Notion", Icon: BookOpen, status: "Available", color: "#00FFFF" },
  { name: "Google Drive", Icon: HardDrive, status: "Available", color: "#9b5cff" },
  { name: "Confluence", Icon: Globe2, status: "Available", color: "#00e87a" },
  { name: "Jira", Icon: ClipboardList, status: "Available", color: "#ffb800" },
  { name: "Slack", Icon: MessageSquare, status: "Available", color: "#3366ff" },
  { name: "GitHub", Icon: Github, status: "Available", color: "#00FFFF" },
  { name: "Salesforce", Icon: Cloud, status: "Coming soon", color: "#9b5cff" },
  { name: "Zendesk", Icon: Ticket, status: "Coming soon", color: "#00e87a" },
];

export default function FilesPage() {
  const { activeWorkspace, activeMembers, activeWorkspaceId } = useWorkspace();
  const [files, setFiles] = useState<FileData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const workspaceMembers = activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? [];
  const filteredFiles = files.filter((file) => {
    const name = file.file_name ?? file.filename ?? "";
    const type = file.file_type ?? file.content_type ?? "";
    const query = searchQuery.toLowerCase();
    return name.toLowerCase().includes(query) || type.toLowerCase().includes(query);
  });

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
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-[18px]">
      <div className="omnix-page-hero">
        <div>
          <h1 className="omnix-page-title flex items-center gap-3">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-sm)]">
              <Database className="h-4 w-4 text-[var(--omnix-cyan)] drop-shadow-[0_0_6px_rgba(0,255,255,0.8)]" />
            </span>
            <span className="omnix-gradient-text">{activeWorkspace?.name ?? "Workspace"} sources</span>
          </h1>
          <p className="omnix-page-subtitle">
            {activeWorkspace?.is_shared
              ? "Shared documents are available to every workspace member."
              : "Upload documents to your workspace. Supported: PDF, DOCX, TXT, Markdown."}
          </p>
        </div>
        {activeWorkspace ? (
          <div className="flex items-center gap-3 rounded-[var(--omnix-radius)] border border-[rgba(0,255,255,0.12)] bg-[rgba(0,255,255,0.05)] px-4 py-3 shadow-[var(--omnix-glow-xs)]">
            <WorkspaceMemberStack members={workspaceMembers} totalCount={activeWorkspace.member_count} size="md" />
            <div className="text-right text-xs">
              <div className="font-semibold text-white">{activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? "member" : "members"}</div>
              <div className="text-[var(--omnix-cyan)] opacity-70">{workspaceRoleLabel(activeWorkspace.current_user_role)}</div>
            </div>
          </div>
        ) : null}
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { label: "Uploaded sources", value: files.length || "Ready", icon: FileText, color: "var(--omnix-cyan)" },
          { label: "Workspace access", value: activeWorkspace?.is_shared ? "Shared" : "Private", icon: ShieldCheck, color: "var(--omnix-green)" },
          { label: "Retrieval state", value: loading ? "Syncing" : "Live", icon: Database, color: "var(--omnix-purple)" },
        ].map((stat) => {
          const Icon = stat.icon;
          return (
            <div key={stat.label} className="omnix-metric-card p-4" style={{ "--metric-color": stat.color } as CSSProperties}>
              <div className="relative z-10 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border" style={{ background: `${stat.color}14`, borderColor: `${stat.color}33` }}>
                  <Icon className="h-4 w-4" style={{ color: stat.color }} />
                </span>
                <span>
                  <span className="omnix-display block text-xl font-semibold text-white">{stat.value}</span>
                  <span className="text-xs text-[var(--omnix-text-3)]">{stat.label}</span>
                </span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        <div className="relative min-w-[220px] flex-1">
          <Search className="absolute left-[11px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-white/25" />
          <input
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search knowledge sources..."
            className="omnix-input h-9 w-full rounded-[var(--omnix-radius-sm)] py-2 pl-8 pr-3 text-xs"
          />
        </div>
        <div className="flex overflow-hidden rounded-[9px] border border-[rgba(0,255,255,0.1)] bg-[rgba(0,255,255,0.03)]">
          {(["grid", "list"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              onClick={() => setView(mode)}
              className="flex h-9 w-10 items-center justify-center transition"
              style={{
                background: view === mode ? "rgba(0,255,255,0.1)" : "transparent",
                color: view === mode ? "var(--omnix-cyan)" : "rgba(255,255,255,0.3)",
              }}
              aria-label={`${mode} view`}
              title={`${mode} view`}
            >
              {mode === "grid" ? <LayoutGrid className="h-3.5 w-3.5" /> : <List className="h-3.5 w-3.5" />}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-cyan)] bg-transparent px-4 text-xs font-bold text-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)] transition hover:bg-cyan-300/10 hover:shadow-[var(--omnix-glow-sm)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Source
        </button>
      </div>

      <div className="omnix-cinematic-card p-4">
        <UploadDropzone />
      </div>

      <div className="omnix-cinematic-card p-5">
        <h2 className="relative z-10 flex items-center gap-2 text-sm font-semibold text-white">
          <FileText className="h-4 w-4 text-cyan-200" />
          {activeWorkspace?.is_shared ? "Shared files" : "Workspace files"}
        </h2>
        {loading ? (
          <div className="relative z-10 mt-4 grid gap-2">
            {[0, 1, 2].map((item) => (
              <div key={item} className="shimmer h-16 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)]" />
            ))}
          </div>
        ) : error ? (
          <p className="relative z-10 mt-4 text-rose-300">{error}</p>
        ) : files.length === 0 ? (
          <div className="relative z-10 mt-4 flex min-h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/10 p-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10 text-cyan-100 shadow-[var(--omnix-glow-xs)]">
              <FileUp className="h-5 w-5" />
            </div>
            <p className="mt-4 text-sm font-semibold text-white">No files uploaded yet.</p>
            <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--omnix-text-2)]">
              Drop a document above to make it available to Omnix retrieval.
            </p>
          </div>
        ) : (
          <div className={view === "grid" ? "relative z-10 mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "relative z-10 mt-3 grid gap-2"}>
            {filteredFiles.map((f) => (
              <div key={f.id} className={view === "grid" ? "omnix-source-card flex min-h-[154px] flex-col justify-between gap-3 p-[18px]" : "omnix-source-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"}>
                <div className="flex min-w-0 items-center gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 shadow-[0_0_14px_rgba(0,255,255,0.12)]">
                    <FileText className="h-[19px] w-[19px]" />
                  </span>
                  <div className="min-w-0">
                    <p className="omnix-display truncate text-[13px] font-bold text-white">{f.file_name ?? f.filename}</p>
                    <p className="mt-1 text-[11px] text-white/35">{f.file_type ?? f.content_type ?? "Document"} - {formatFileSize(f.size_bytes)}</p>
                  </div>
                </div>
                <div className={view === "grid" ? "flex items-center gap-2 border-t border-white/5 pt-3" : "flex items-center gap-2"}>
                  <Button type="button" size="sm" variant="ghost" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => handleDownload(f.id, f.file_name ?? f.filename ?? "download")}>Download</Button>
                  <Button type="button" size="sm" variant="ghost" className="text-rose-200 hover:bg-rose-400/10 hover:text-rose-100" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => handleDelete(f.id)}>Delete</Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="omnix-cinematic-card p-5">
        <div className="relative z-10 mb-4">
          <h2 className="omnix-display text-[15px] font-bold text-white">Add Connector</h2>
          <p className="mt-1 text-[11px] text-white/35">Connect your tools and sync data automatically</p>
        </div>
        <div className="relative z-10 grid gap-2.5 sm:grid-cols-2 md:grid-cols-4 xl:grid-cols-8">
          {connectors.map((connector) => {
            const Icon = connector.Icon;
            return (
              <button
                key={connector.name}
                type="button"
                disabled={connector.status !== "Available"}
                className="flex flex-col items-center gap-2 rounded-[var(--omnix-radius-sm)] border border-white/[0.06] bg-white/[0.02] px-2 py-3.5 text-center transition hover:-translate-y-0.5 disabled:cursor-default disabled:opacity-40"
                style={{ "--connector-color": connector.color } as CSSProperties}
              >
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-[9px] border"
                  style={{
                    background: `${connector.color}12`,
                    borderColor: `${connector.color}22`,
                    boxShadow: `0 0 8px ${connector.color}15`,
                  }}
                >
                  <Icon className="h-4 w-4" style={{ color: connector.color }} />
                </span>
                <span className="text-[10px] text-white/45">{connector.name}</span>
                {connector.status === "Coming soon" ? (
                  <span className="text-[8px] font-semibold text-white/25">SOON</span>
                ) : null}
              </button>
            );
          })}
        </div>
      </div>
      </div>
    </section>
  );
}
