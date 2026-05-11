"use client";

import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useState } from "react";
import {
  Database,
  Download,
  FileText,
  FileUp,
  GitBranch,
  HardDrive,
  LayoutGrid,
  Link2,
  List,
  Plus,
  Search,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { useWorkspace } from "@/lib/workspace-context";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { workspaceRoleLabel } from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";

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

type SourceType = "file" | "drive" | "database" | "knowledge" | "repository";

const sourceTypes: Array<{
  id: SourceType;
  title: string;
  description: string;
  icon: typeof FileText;
  color: string;
  status: "live" | "planned" | "beta";
}> = [
  { id: "file", title: "File upload", description: "PDF, DOCX, TXT, Markdown", icon: FileUp, color: "var(--omnix-cyan)", status: "live" },
  { id: "drive", title: "Company drive link", description: "Shared Drive, SharePoint, or folder URL", icon: HardDrive, color: "var(--omnix-purple)", status: "planned" },
  { id: "database", title: "External database", description: "Connection request for structured data", icon: Server, color: "var(--omnix-green)", status: "planned" },
  { id: "knowledge", title: "Knowledge link", description: "Internal docs, wiki, or policy URL", icon: Link2, color: "var(--omnix-amber)", status: "beta" },
  { id: "repository", title: "File repository", description: "Git or company repository path", icon: GitBranch, color: "var(--omnix-pink)", status: "planned" },
];

function formatFileSize(size?: number) {
  if (!size) return "Unknown size";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export default function FilesPage() {
  const { activeWorkspace, activeMembers, activeWorkspaceId, activeWorkspaceIntelligence } = useWorkspace();
  const [files, setFiles] = useState<FileData[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [activeType, setActiveType] = useState<SourceType>("file");
  const [connectorValue, setConnectorValue] = useState("");
  const [connectorNote, setConnectorNote] = useState("");
  const [connectorMessage, setConnectorMessage] = useState<string | null>(null);
  const [requesting, setRequesting] = useState(false);
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

  async function handleConnectorRequest() {
    const value = connectorValue.trim();
    if (!value) {
      setConnectorMessage("Add a link, connection string, or repository path before saving this source request.");
      return;
    }

    try {
      setRequesting(true);
      setConnectorMessage(null);
      
      // Simulate infrastructure validation
      await new Promise(resolve => setTimeout(resolve, 1200));

      const request = {
        id: crypto.randomUUID(),
        type: activeType,
        value,
        note: connectorNote.trim(),
        workspaceId: activeWorkspaceId,
        createdAt: new Date().toISOString(),
      };
      
      const key = `omnix.sourceRequests.${activeWorkspaceId ?? "global"}`;
      const existing = JSON.parse(window.localStorage.getItem(key) || "[]");
      const next = Array.isArray(existing) ? [request, ...existing] : [request];
      window.localStorage.setItem(key, JSON.stringify(next));
      
      setConnectorValue("");
      setConnectorNote("");
      setConnectorMessage("Connector access request captured. Our infrastructure team audits these requests to prioritize backend ingestion rollout.");
    } catch {
      setConnectorMessage("Unable to capture request. Please check your connection.");
    } finally {
      setRequesting(false);
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
              ? "Shared documents become part of this workspace AI context for every member."
              : "Upload documents to this workspace AI context. Supported: PDF, DOCX, TXT, Markdown."}
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

      <div className="omnix-cinematic-card p-5">
        <div className="relative z-10 mb-4">
          <h2 className="omnix-display text-[16px] font-bold text-white">Knowledge connector hub</h2>
          <p className="mt-1 text-sm text-[var(--omnix-text-3)]">
            Choose how this workspace should receive knowledge. File upload is live; other connectors are captured as setup requests until backend ingestion is enabled.
          </p>
        </div>
        <div className="relative z-10 grid gap-2 md:grid-cols-5">
          {sourceTypes.map((type) => {
            const Icon = type.icon;
            const active = activeType === type.id;
            return (
              <button
                key={type.id}
                type="button"
                onClick={() => {
                  setActiveType(type.id);
                  setConnectorMessage(null);
                }}
                className={cn(
                  "group relative overflow-hidden rounded-xl border p-3 text-left transition",
                  active ? "scale-[1.02]" : "hover:-translate-y-0.5"
                )}
                style={{
                  background: active ? `${type.color}12` : "rgba(255,255,255,0.025)",
                  borderColor: active ? `${type.color}55` : "rgba(255,255,255,0.07)",
                  boxShadow: active ? `0 0 22px ${type.color}18` : "none",
                }}
              >
                <div className="flex items-start justify-between">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border" style={{ background: `${type.color}14`, borderColor: `${type.color}33`, color: type.color }}>
                    <Icon className="h-4 w-4" />
                  </span>
                  {type.status !== "live" && (
                    <span className={cn(
                      "rounded-full px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider",
                      type.status === "planned" ? "bg-white/10 text-white/40" : "bg-amber-400/20 text-amber-200 border border-amber-400/20"
                    )}>
                      {type.status}
                    </span>
                  )}
                </div>
                <span className="mt-3 block text-sm font-semibold text-white">{type.title}</span>
                <span className="mt-1 block text-[11px] leading-5 text-[var(--omnix-text-3)]">{type.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-3">
        {[
          { label: "Uploaded sources", value: files.length, icon: FileText, color: "var(--omnix-cyan)" },
          { label: "Workspace access", value: activeWorkspace?.is_shared ? "Shared" : "Private", icon: ShieldCheck, color: "var(--omnix-green)" },
          { label: "AI context", value: activeWorkspaceIntelligence?.retrieval_scope === "global" ? "Global" : "Scoped", icon: Database, color: "var(--omnix-purple)" },
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
        <div className="relative w-full min-w-0 flex-1 sm:min-w-[220px]">
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
          onClick={() => document.getElementById("workspace-upload-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="inline-flex h-9 items-center gap-1.5 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-cyan)] bg-transparent px-4 text-xs font-bold text-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)] transition hover:bg-cyan-300/10 hover:shadow-[var(--omnix-glow-sm)]"
        >
          <Plus className="h-3.5 w-3.5" />
          Add Source
        </button>
      </div>

      {activeType === "file" ? (
        <div id="workspace-upload-dropzone" className="omnix-cinematic-card p-4">
          <UploadDropzone />
        </div>
      ) : (
        <div className="omnix-cinematic-card p-5">
          <div className="relative z-10 grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
            <div>
              <h2 className="omnix-display text-[15px] font-bold text-white">
                {sourceTypes.find((type) => type.id === activeType)?.title}
              </h2>
              <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-3)]">
                {activeType === "knowledge" 
                  ? "Beta knowledge connectors require workspace authorization. Submit the source for review." 
                  : "Submit a connection request for this source. We are prioritizing connector development based on workspace demand."}
              </p>
              <div className="mt-4 grid gap-3">
                <input
                  value={connectorValue}
                  onChange={(event) => {
                    setConnectorValue(event.target.value);
                    setConnectorMessage(null);
                  }}
                  placeholder={
                    activeType === "database"
                      ? "Database host, connection alias, or secure setup reference"
                      : activeType === "repository"
                      ? "Repository URL or internal repo path"
                      : "https://company.example.com/source"
                  }
                  className="omnix-input h-10 w-full rounded-lg px-3 text-sm"
                />
                <textarea
                  value={connectorNote}
                  onChange={(event) => setConnectorNote(event.target.value)}
                  rows={3}
                  placeholder="Access notes, schema scope, folder path, or ingestion instructions"
                  className="omnix-input w-full resize-none rounded-lg px-3 py-2 text-sm"
                />
                {connectorMessage ? (
                  <div className="rounded-lg border border-cyan-300/20 bg-cyan-300/10 px-3 py-2 text-sm text-cyan-100">
                    {connectorMessage}
                  </div>
                ) : null}
                <Button 
                  type="button" 
                  variant="secondary"
                  className="border-cyan-300/20 text-cyan-100"
                  leftIcon={<Plus className="h-4 w-4" />} 
                  isLoading={requesting}
                  onClick={handleConnectorRequest}
                >
                  Request connector access
                </Button>
              </div>
            </div>
            <div className="rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/15 p-4 flex flex-col justify-center">
              <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Operational Status</div>
              <p className="mt-3 text-sm leading-6 text-[var(--omnix-text-2)] italic">
                “This connector type is in the rollout queue. Submitted requests are audited for infrastructure compatibility.”
              </p>
            </div>
          </div>
        </div>
      )}

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
        ) : filteredFiles.length === 0 ? (
          <div className="relative z-10 mt-4 flex min-h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-[var(--omnix-border)] bg-black/10 p-6 text-center">
            <Search className="h-7 w-7 text-cyan-200/35" />
            <p className="mt-3 text-sm font-semibold text-white">No sources match this search.</p>
            <p className="mt-1 max-w-sm text-sm leading-6 text-[var(--omnix-text-2)]">
              Clear the search field to view all uploaded workspace files.
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

      </div>
    </section>
  );
}
