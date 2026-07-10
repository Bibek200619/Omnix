"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import dynamic from "next/dynamic";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  BadgeCheck,
  Database,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  LayoutGrid,
  Link2,
  List,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { ConnectorSetupModal } from "@/components/files/ConnectorSetupModal";
import { SourceHealthConsole } from "@/components/files/SourceHealthConsole";
import { CreateDecisionModal } from "@/components/decisions/CreateDecisionModal";
import { DocumentPortal } from "@/components/files/DocumentPortal";
import { DecisionCandidatePanel } from "@/components/decisions/DecisionCandidatePanel";
import { EmptyState } from "@/components/ui/EmptyState";
import { OmnixErrorState } from "@/components/ui/OmnixErrorState";
import { Skeleton } from "@/components/ui/Skeleton";
import { logClientError } from "@/lib/errors";
import { useWorkspaceIntelligence, useWorkspaceMembership, useWorkspaceTree } from "@/lib/workspace-context";
import { WorkspaceMemberStack } from "@/components/workspace/WorkspaceMemberStack";
import { workspaceRoleLabel } from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";
import type { MessageAttachment } from "@/components/chat/types";
import type { DecisionCandidate, DecisionCandidateList, WorkspaceDecisionSourceType, WorkspaceDecisionStatus } from "@/lib/workspace-types";
import {
  connectorAccent,
  connectorIcon,
  connectorSummary,
  emptyForm,
  fileIngestionStatus,
  fileStatusDetail,
  fileStatusLabel,
  fileStatusStyle,
  formatDate,
  formatFileSize,
  formFromConnector,
  newestConnector,
  sourceTypes,
  statusLabel,
  statusStyle,
  valueFromConfig,
  type ConnectorFormState,
  type ConnectorType,
  type FileData,
  type SourceSection,
  type SourceType,
  type WorkspaceConnector,
} from "@/components/files/filesPageModel";

const UploadDropzone = dynamic(() => import("@/components/upload/UploadDropzone").then((m) => m.UploadDropzone), { ssr: false });

export default function FilesPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <FilesPageContent />
    </Suspense>
  );
}

function FilesPageContent() {
  const { activeWorkspace, activeWorkspaceId } = useWorkspaceTree();
  const { activeMembers } = useWorkspaceMembership();
  const { activeWorkspaceIntelligence } = useWorkspaceIntelligence();
  const [files, setFiles] = useState<FileData[]>([]);
  const [connectors, setConnectors] = useState<WorkspaceConnector[]>([]);
  const [loading, setLoading] = useState(false);
  const [connectorsLoading, setConnectorsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectorError, setConnectorError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [activeSection, setActiveSection] = useState<SourceSection>("files");
  const [activeType, setActiveType] = useState<SourceType>("file");
  const [setupType, setSetupType] = useState<ConnectorType | null>(null);
  const [setupForm, setSetupForm] = useState<ConnectorFormState>(emptyForm("knowledge_link"));
  const [setupMessage, setSetupMessage] = useState<string | null>(null);
  const [savingConnector, setSavingConnector] = useState(false);
  const [actionConnectorId, setActionConnectorId] = useState<string | null>(null);
  const [authConnectorId, setAuthConnectorId] = useState<string | null>(null);
  const [candidateFile, setCandidateFile] = useState<FileData | null>(null);
  const [decisionCandidates, setDecisionCandidates] = useState<DecisionCandidate[]>([]);
  const [decisionCandidatesLoading, setDecisionCandidatesLoading] = useState(false);
  const [decisionCandidatesError, setDecisionCandidatesError] = useState<string | null>(null);
  const [decisionCandidateDraft, setDecisionCandidateDraft] = useState<{
    title: string;
    reason: string;
    description: string;
    status: WorkspaceDecisionStatus;
    source_type: WorkspaceDecisionSourceType;
    source_id: string;
  } | null>(null);
  const fileResultsRef = useRef<HTMLDivElement | null>(null);
  const [gridColumnCount, setGridColumnCount] = useState(1);
  const workspaceMembers = activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? [];

  const filteredFiles = useMemo(() => files.filter((file) => {
    const name = file.file_name ?? file.filename ?? "";
    const type = file.file_type ?? file.content_type ?? "";
    const query = searchQuery.toLowerCase();
    return name.toLowerCase().includes(query) || type.toLowerCase().includes(query);
  }), [files, searchQuery]);

  const virtualFileRows = useMemo(() => {
    if (view === "list") return filteredFiles.map((file) => [file]);
    const columns = Math.max(gridColumnCount, 1);
    return Array.from({ length: Math.ceil(filteredFiles.length / columns) }, (_, row) => {
      const index = row * columns;
      return filteredFiles.slice(index, index + columns);
    });
  }, [filteredFiles, gridColumnCount, view]);

  const shouldVirtualizeFiles = filteredFiles.length > 40;
  const fileVirtualizer = useVirtualizer({
    count: virtualFileRows.length,
    getScrollElement: () => fileResultsRef.current,
    estimateSize: () => (view === "grid" ? 228 : 104),
    getItemKey: (index) => virtualFileRows[index]?.map((file) => file.id).join(":") ?? index,
    overscan: view === "grid" ? 4 : 8,
  });

  useEffect(() => {
    if (view !== "grid") {
      setGridColumnCount(1);
      return;
    }

    const node = fileResultsRef.current;
    if (!node || typeof ResizeObserver === "undefined") return;

    const updateColumns = () => setGridColumnCount(node.clientWidth >= 1280 ? 3 : node.clientWidth >= 768 ? 2 : 1);

    updateColumns();
    const observer = new ResizeObserver(updateColumns);
    observer.observe(node);
    return () => observer.disconnect();
  }, [view, shouldVirtualizeFiles]);

  const connectorCounts = useMemo(() => {
    return connectors.reduce<Record<ConnectorType, number>>(
      (counts, connector) => {
        counts[connector.connector_type] += 1;
        return counts;
      },
      { knowledge_link: 0, file_repository: 0, company_drive: 0, external_database: 0 },
    );
  }, [connectors]);

  const loadFiles = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient.get<FileData[]>("/files");
      setFiles(data);
    } catch (err) {
      logClientError("Failed to load files", err, { endpoint: "/files" });
      setError("Unable to load files. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConnectors = useCallback(async () => {
    if (!activeWorkspaceId) {
      setConnectors([]);
      return;
    }
    setConnectorsLoading(true);
    setConnectorError(null);
    try {
      const data = await apiClient.get<WorkspaceConnector[]>("/connectors");
      setConnectors(data);
    } catch (err) {
      logClientError("Failed to load connectors", err, { endpoint: "/connectors" });
      setConnectorError("Unable to load connectors. Check your connection and try again.");
    } finally {
      setConnectorsLoading(false);
    }
  }, [activeWorkspaceId]);

  useEffect(() => {
    void loadFiles();
    void loadConnectors();
  }, [activeWorkspaceId, loadFiles, loadConnectors]);

  function upsertConnector(connector: WorkspaceConnector) {
    setConnectors((current) => {
      const exists = current.some((item) => item.id === connector.id);
      if (exists) {
        return current.map((item) => (item.id === connector.id ? connector : item));
      }
      return [connector, ...current];
    });
  }

  function openSetup(type: ConnectorType, connector?: WorkspaceConnector) {
    setActiveType(type);
    setSetupType(type);
    setSetupForm(formFromConnector(type, connector));
    setSetupMessage(null);
    setConnectorError(null);
  }

  function scrollToUpload() {
    setActiveSection("files");
    setActiveType("file");
    window.setTimeout(() => {
      document.getElementById("workspace-upload-dropzone")?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 50);
  }

  async function handleDelete(id: string) {
    try {
      await apiClient.request(`/files/${id}`, { method: "DELETE" });
      setFiles((s) => s.filter((f) => f.id !== id));
    } catch (err) {
      logClientError("Failed to delete file", err, { endpoint: `/files/${id}` });
      setError("Unable to delete file. Your session may have expired; refresh and try again.");
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
      logClientError("Failed to download file", err, { endpoint: `/files/${id}/download` });
      setError("Unable to download file. Check your connection and try again.");
    }
  }

  async function scanDocumentDecisionCandidates(file: FileData) {
    if (!activeWorkspaceId) {
      setError("Select a workspace before scanning document decisions.");
      return;
    }
    setCandidateFile(file);
    setDecisionCandidates([]);
    setDecisionCandidatesLoading(true);
    setDecisionCandidatesError(null);
    try {
      const result = await apiClient.post<DecisionCandidateList>(
        `/workspaces/${activeWorkspaceId}/decisions/candidates/document/${file.id}`,
        {},
      );
      setDecisionCandidates(result.candidates);
    } catch (err) {
      logClientError("Failed to extract document decision candidates", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions/candidates/document/${file.id}` });
      setDecisionCandidatesError("Unable to scan this document for decision candidates. Please try again in a moment.");
    } finally {
      setDecisionCandidatesLoading(false);
    }
  }

  async function openCandidateDecision(candidate: DecisionCandidate) {
    if (!activeWorkspaceId) return;
    setDecisionCandidateDraft({
      title: candidate.title,
      reason: candidate.reason,
      description: `Supporting evidence:\n${candidate.supporting_evidence.join("\n")}`,
      status: "proposed",
      source_type: candidate.source_type,
      source_id: candidate.source_id,
    });
    try {
      await apiClient.post(`/workspaces/${activeWorkspaceId}/decisions/candidates/metrics`, {
        action: "accept",
        candidate_id: candidate.id,
        source_type: candidate.source_type,
        source_id: candidate.source_id,
      });
    } catch (err) {
      logClientError("Failed to log document decision candidate acceptance", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions/candidates/metrics` });
    }
  }

  async function dismissDecisionCandidate(candidate: DecisionCandidate) {
    setDecisionCandidates((current) => current.filter((item) => item.id !== candidate.id));
    if (!activeWorkspaceId) return;
    try {
      await apiClient.post(`/workspaces/${activeWorkspaceId}/decisions/candidates/metrics`, {
        action: "dismiss",
        candidate_id: candidate.id,
        source_type: candidate.source_type,
        source_id: candidate.source_id,
      });
    } catch (err) {
      logClientError("Failed to log document decision candidate dismissal", err, { endpoint: `/workspaces/${activeWorkspaceId}/decisions/candidates/metrics` });
    }
  }

  function handleUploadSuccess(uploaded: MessageAttachment) {
    if (!uploaded?.id) return;
    setFiles((current) => {
      if (current.some((file) => file.id === uploaded.id)) return current;
      return [uploaded as FileData, ...current];
    });
  }

  function buildConnectorPayload() {
    if (!setupType) return null;
    const displayName = setupForm.displayName.trim() || undefined;
    if (setupType === "knowledge_link") {
      if (!setupForm.url.trim()) return { error: "Add a docs, wiki, or policy URL before saving." };
      return {
        payload: {
          workspace_id: activeWorkspaceId,
          connector_type: setupType,
          display_name: displayName,
          config: { url: setupForm.url.trim(), notes: setupForm.notes.trim() || undefined },
        },
      };
    }
    if (setupType === "file_repository") {
      if (!setupForm.repository.trim()) return { error: "Add a repository URL or internal path before saving." };
      return {
        payload: {
          workspace_id: activeWorkspaceId,
          connector_type: setupType,
          display_name: displayName,
          config: {
            repository: setupForm.repository.trim(),
            branch: setupForm.branch.trim() || undefined,
            auth_mode: setupForm.authMode,
            credential_reference: setupForm.credentialReference.trim() || undefined,
            notes: setupForm.notes.trim() || undefined,
          },
        },
      };
    }
    if (setupType === "company_drive") {
      if (!setupForm.url.trim()) return { error: "Add a shared drive or folder URL before saving." };
      return {
        payload: {
          workspace_id: activeWorkspaceId,
          connector_type: setupType,
          display_name: displayName,
          config: {
            url: setupForm.url.trim(),
            provider: setupForm.provider === "auto" ? undefined : setupForm.provider,
            notes: setupForm.notes.trim() || undefined,
          },
        },
      };
    }
    if (!setupForm.host.trim() || !setupForm.database.trim()) {
      return { error: "Add the database host and database name before saving." };
    }
    return {
      payload: {
        workspace_id: activeWorkspaceId,
        connector_type: setupType,
        display_name: displayName,
        config: {
          engine: setupForm.engine,
          host: setupForm.host.trim(),
          port: setupForm.port.trim() || undefined,
          database: setupForm.database.trim(),
          schema: setupForm.schema.trim() || undefined,
          auth_mode: setupForm.dbAuthMode,
          credential_reference: setupForm.credentialReference.trim() || undefined,
          notes: setupForm.notes.trim() || undefined,
        },
      },
    };
  }

  async function handleSaveConnector() {
    if (!setupType) return;
    const built = buildConnectorPayload();
    if (!built || "error" in built) {
      setSetupMessage(built?.error ?? "Connector setup is incomplete.");
      return;
    }

    try {
      setSavingConnector(true);
      setSetupMessage(null);
      const connector = await apiClient.post<WorkspaceConnector>("/connectors", built.payload);
      upsertConnector(connector);
      setSetupType(null);
      setSetupMessage(null);
    } catch (err) {
      logClientError("Failed to save connector", err, { endpoint: "/connectors" });
      setSetupMessage("Unable to save connector. Check the configuration and try again.");
    } finally {
      setSavingConnector(false);
    }
  }

  async function handleRetryConnector(connector: WorkspaceConnector) {
    try {
      setActionConnectorId(connector.id);
      setConnectorError(null);
      const updated = await apiClient.post<WorkspaceConnector>(`/connectors/${connector.id}/retry`, {});
      upsertConnector(updated);
    } catch (err) {
      logClientError("Failed to retry connector", err, { endpoint: `/connectors/${connector.id}/retry` });
      setConnectorError("Unable to retry connector. Please try again in a moment.");
    } finally {
      setActionConnectorId(null);
    }
  }

  async function handleRemoveConnector(connector: WorkspaceConnector) {
    try {
      setActionConnectorId(connector.id);
      setConnectorError(null);
      await apiClient.delete(`/connectors/${connector.id}`);
      setConnectors((current) => current.filter((item) => item.id !== connector.id));
      if (connector.source_file_id) {
        setFiles((current) => current.filter((file) => file.id !== connector.source_file_id));
      }
    } catch (err) {
      logClientError("Failed to remove connector", err, { endpoint: `/connectors/${connector.id}` });
      setConnectorError("Unable to delete connector. Your session may have expired; refresh and try again.");
    } finally {
      setActionConnectorId(null);
    }
  }

  async function handleDriveAuth(connector?: WorkspaceConnector) {
    try {
      setAuthConnectorId(connector?.id ?? "setup");
      setConnectorError(null);
      const suffix = activeWorkspaceId ? `?workspace_id=${encodeURIComponent(activeWorkspaceId)}` : "";
      const result = await apiClient.get<{ authorize_url: string }>(`/integrations/google_drive/connect${suffix}`);
      window.location.assign(result.authorize_url);
    } catch (err) {
      logClientError("Failed to start connector authentication", err, { endpoint: "/integrations/google_drive/connect" });
      setConnectorError("Unable to start connector authentication. Check your connection and try again.");
    } finally {
      setAuthConnectorId(null);
    }
  }

  function renderFileCard(f: FileData) {
    const ingestionStatus = fileIngestionStatus(f);
    return (
      <div key={f.id} className={view === "grid" ? "omnix-source-card flex min-h-[174px] flex-col justify-between gap-3 p-[18px]" : "omnix-source-card flex flex-col gap-3 p-3 sm:flex-row sm:items-center sm:justify-between"}>
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border border-cyan-300/20 bg-cyan-300/10 text-cyan-100 shadow-[0_0_14px_var(--omnix-rgba-0-255-255-0-12)]">
            <FileText className="h-[19px] w-[19px]" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <p className="omnix-display max-w-full truncate text-[13px] font-bold text-white">{f.file_name ?? f.filename}</p>
              <span className={cn("rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider", fileStatusStyle[ingestionStatus])}>
                {fileStatusLabel[ingestionStatus]}
              </span>
            </div>
            <p className="mt-1 text-[11px] text-white/35">{f.file_type ?? f.content_type ?? "Document"} - {formatFileSize(f.size_bytes)}</p>
            <p className="mt-2 max-w-3xl text-[11px] leading-5 text-white/50">{fileStatusDetail(f)}</p>
          </div>
        </div>
        <div className={view === "grid" ? "grid grid-cols-2 gap-2 border-t border-white/5 pt-3 sm:flex sm:items-center" : "grid grid-cols-2 gap-2 sm:flex sm:items-center"}>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" leftIcon={<BadgeCheck className="h-3.5 w-3.5" />} onClick={() => void scanDocumentDecisionCandidates(f)}>Decisions</Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-11" leftIcon={<Download className="h-3.5 w-3.5" />} onClick={() => handleDownload(f.id, f.file_name ?? f.filename ?? "download")}>Download</Button>
          <Button type="button" size="sm" variant="ghost" className="min-h-11 text-rose-200 hover:bg-rose-400/10 hover:text-rose-100" leftIcon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => handleDelete(f.id)}>Delete</Button>
        </div>
      </div>
    );
  }

  const setupMeta = setupType ? sourceTypes.find((item) => item.id === setupType) : null;
  const connectorSourceTypes = sourceTypes.filter(
    (type): type is (typeof sourceTypes)[number] & { id: ConnectorType } => type.id !== "file",
  );

  return (
    <section className="omnix-page-frame omnix-scrollbar">
      <div className="omnix-content-max flex flex-col gap-[18px]">
        <div className="omnix-page-hero">
          <div>
            <h1 className="omnix-page-title flex items-center gap-3">
              <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/[0.08] shadow-[var(--omnix-glow-sm)]">
                <Database className="h-4 w-4 text-[var(--omnix-cyan)] drop-shadow-[0_0_6px_var(--omnix-rgba-0-255-255-0-8)]" />
              </span>
              <span className="omnix-gradient-text">{activeWorkspace?.name ?? "Workspace"} sources</span>
            </h1>
            <p className="omnix-page-subtitle">
              Manage workspace knowledge connectors with saved configuration, honest status, and retrievable source continuity.
            </p>
          </div>
          {activeWorkspace ? (
            <div className="flex items-center gap-3 rounded-[var(--omnix-radius)] border border-[var(--omnix-rgba-0-255-255-0-12)] bg-[var(--omnix-rgba-0-255-255-0-05)] px-4 py-3 shadow-[var(--omnix-glow-xs)]">
              <WorkspaceMemberStack members={workspaceMembers} totalCount={activeWorkspace.member_count} size="md" />
              <div className="text-right text-xs">
                <div className="font-semibold text-white">{activeWorkspace.member_count} {activeWorkspace.member_count === 1 ? "member" : "members"}</div>
                <div className="text-[var(--omnix-cyan)] opacity-70">{workspaceRoleLabel(activeWorkspace.current_user_role)}</div>
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex flex-col gap-3 rounded-[var(--omnix-radius)] border border-[var(--omnix-border)] bg-black/15 p-2 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex gap-1 rounded-[10px] bg-black/20 p-1">
            {([
              { id: "files", label: "Files", count: files.length },
              { id: "connectors", label: "Connectors", count: connectors.length },
            ] as Array<{ id: SourceSection; label: string; count: number }>).map((section) => (
              <button
                key={section.id}
                type="button"
                onClick={() => setActiveSection(section.id)}
                className={cn(
                  "inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-3 text-xs font-bold uppercase tracking-[0.08em] transition sm:flex-none",
                  activeSection === section.id
                    ? "bg-cyan-300/12 text-cyan-100 shadow-[var(--omnix-glow-xs)]"
                    : "text-[var(--omnix-text-3)] hover:bg-white/[0.035] hover:text-white",
                )}
              >
                {section.label}
                <span className="rounded-full border border-white/10 bg-black/20 px-1.5 py-px text-[10px] text-white/55">
                  {section.count}
                </span>
              </button>
            ))}
          </div>
          <p className="px-1 text-xs leading-5 text-[var(--omnix-text-3)]">
            {activeSection === "files"
              ? "Upload, search, and inspect retrievable workspace files."
              : "Configure external knowledge systems and monitor connector status."}
          </p>
        </div>

        {activeSection === "connectors" ? (
        <div className="omnix-cinematic-card p-5">
          <div className="relative z-10 mb-4 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <h2 className="omnix-display text-[16px] font-bold text-white">Knowledge connector hub</h2>
              <p className="mt-1 text-sm text-[var(--omnix-text-3)]">
                Configure sources for this workspace. Public knowledge links sync immediately when reachable; repository, drive, and database connectors save setup requests for rollout.
              </p>
            </div>
            {connectorsLoading ? (
              <Skeleton className="h-8 w-28 rounded-full" />
            ) : null}
          </div>
          <div className="relative z-10 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            {connectorSourceTypes.map((type) => {
              const Icon = type.icon;
              const active = activeType === type.id;
              const latest = newestConnector(connectors, type.id);
              const cardStatus = latest?.status ?? "not_configured";
              const count = connectorCounts[type.id];
              return (
                <button
                  key={type.id}
                  type="button"
                  onClick={() => {
                    openSetup(type.id, latest ?? undefined);
                  }}
                  className={cn(
                    "group relative flex min-h-[154px] flex-col justify-between overflow-hidden rounded-xl border p-3 text-left transition",
                    active ? "scale-[1.01]" : "hover:-translate-y-0.5",
                  )}
                  style={{
                    background: active ? type.activeSurface : type.surface,
                    borderColor: active ? type.activeBorder : type.border,
                    boxShadow: active ? `0 0 22px ${type.shadow}` : "none",
                  }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="flex h-9 w-9 items-center justify-center rounded-lg border" style={{ background: type.iconSurface, borderColor: type.iconBorder, color: type.color }}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className={cn("rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider", statusStyle[cardStatus])}>
                      {statusLabel[cardStatus]}
                    </span>
                  </div>
                  <span>
                    <span className="mt-3 block text-sm font-semibold text-white">{type.title}</span>
                    <span className="mt-1 block text-[11px] leading-5 text-[var(--omnix-text-3)]">{type.description}</span>
                  </span>
                  <span className="mt-3 flex items-center justify-between border-t border-white/5 pt-3 text-[11px]">
                    <span className="text-white/40">{count} saved</span>
                    <span className="font-semibold" style={{ color: type.color }}>{type.action}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
        ) : null}

        <div className="grid gap-3 md:grid-cols-3">
          {[
            { label: "Uploaded sources", value: files.length, icon: FileText, color: "var(--omnix-cyan)", surface: "var(--omnix-rgba-0-255-255-0-14)", border: "var(--omnix-rgba-0-255-255-0-28)" },
            { label: "Configured connectors", value: connectors.length, icon: Link2, color: "var(--omnix-amber)", surface: "var(--omnix-rgba-255-184-0-14)", border: "var(--omnix-rgba-255-184-0-28)" },
            { label: "AI context", value: activeWorkspaceIntelligence?.retrieval_scope === "global" ? "Global" : "Scoped", icon: Database, color: "var(--omnix-purple)", surface: "var(--omnix-rgba-155-92-255-0-14)", border: "var(--omnix-rgba-155-92-255-0-28)" },
          ].map((stat) => {
            const Icon = stat.icon;
            return (
              <div key={stat.label} className="omnix-metric-card p-4" style={{ "--metric-color": stat.color } as CSSProperties}>
                <div className="relative z-10 flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-lg border" style={{ background: stat.surface, borderColor: stat.border }}>
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
        <SourceHealthConsole files={files} connectors={connectors} actionConnectorId={actionConnectorId} onRetryConnector={(connector) => void handleRetryConnector(connector)} />

        {activeSection === "connectors" ? (
        <div className="omnix-cinematic-card p-5">
          <div className="relative z-10 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-white">
              <Link2 className="h-4 w-4 text-amber-200" />
              Saved connectors
            </h2>
            <Button type="button" size="sm" variant="ghost" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void loadConnectors()} isLoading={connectorsLoading}>
              Recheck
            </Button>
          </div>
          {connectorError ? (
            <OmnixErrorState
              compact
              className="relative z-10 mt-4"
              title={connectorError.startsWith("Unable to load connectors.") ? "Connectors are unavailable" : "Connector action needs attention"}
              message={connectorError}
              onRetry={connectorError.startsWith("Unable to load connectors.") ? () => void loadConnectors() : undefined}
              isRetrying={connectorsLoading}
              onDismiss={() => setConnectorError(null)}
            />
          ) : null}
          {connectorsLoading && connectors.length === 0 ? (
            <div className="relative z-10 mt-4 grid gap-2">
              {[0, 1].map((item) => <Skeleton key={item} className="h-16 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)]" />)}
            </div>
          ) : connectors.length === 0 ? (
            <EmptyState
              icon={Unplug}
              title="No connector configuration saved yet"
              description="Choose a connector above to save a real workspace-scoped setup."
              className="relative z-10 mt-4 min-h-[220px] border-dashed"
            />
          ) : (
            <div className="relative z-10 mt-4 grid gap-3">
              {connectors.map((connector) => {
                const Icon = connectorIcon(connector.connector_type);
                const accent = connectorAccent(connector.connector_type);
                const busy = actionConnectorId === connector.id;
                const googleDriveNeedsAuth =
                  connector.connector_type === "company_drive" &&
                  connector.status === "needs_authentication" &&
                  valueFromConfig(connector.config, "provider") === "google_drive";
                return (
                  <div key={connector.id} className="omnix-source-card flex flex-col gap-4 p-4 lg:flex-row lg:items-center lg:justify-between">
                    <div className="flex min-w-0 gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[11px] border" style={{ background: accent.iconSurface, borderColor: accent.iconBorder, color: accent.color }}>
                        <Icon className="h-[18px] w-[18px]" />
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="omnix-display max-w-full truncate text-[13px] font-bold text-white">{connector.display_name}</p>
                          <span className={cn("rounded-full border px-2 py-1 text-[9px] font-bold uppercase tracking-wider", statusStyle[connector.status])}>
                            {statusLabel[connector.status]}
                          </span>
                        </div>
                        <p className="mt-1 max-w-3xl break-words text-[11px] leading-5 text-white/45">{connectorSummary(connector)}</p>
                        <p className="mt-1 text-[11px] text-white/35">
                          {connector.status === "connected" ? `Last synced ${formatDate(connector.last_synced_at)}` : connector.job?.status ? `Job ${connector.job.status}` : "Configuration persisted"}
                        </p>
                        {connector.last_error ? (
                          <p className="mt-2 max-w-3xl text-[11px] leading-5 text-amber-100/80">{connector.last_error}</p>
                        ) : null}
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center lg:justify-end">
                      {googleDriveNeedsAuth ? (
                        <Button type="button" size="sm" variant="secondary" className="min-h-11" leftIcon={<ExternalLink className="h-3.5 w-3.5" />} isLoading={authConnectorId === connector.id} onClick={() => void handleDriveAuth(connector)}>
                          Authenticate
                        </Button>
                      ) : null}
                      <Button type="button" size="sm" variant="ghost" className="min-h-11" leftIcon={<RefreshCw className="h-3.5 w-3.5" />} isLoading={busy} onClick={() => void handleRetryConnector(connector)}>
                        Retry
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="min-h-11" leftIcon={<Plus className="h-3.5 w-3.5" />} onClick={() => openSetup(connector.connector_type, connector)}>
                        Configure
                      </Button>
                      <Button type="button" size="sm" variant="ghost" className="min-h-11 text-rose-200 hover:bg-rose-400/10 hover:text-rose-100" leftIcon={<Unplug className="h-3.5 w-3.5" />} isLoading={busy} onClick={() => void handleRemoveConnector(connector)}>
                        Remove
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        ) : null}

        {activeSection === "files" ? (
        <>
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="relative w-full min-w-0 flex-1 sm:min-w-[220px]">
            <Search className="absolute left-[11px] top-1/2 h-[13px] w-[13px] -translate-y-1/2 text-white/25" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search knowledge sources..."
              className="omnix-input h-11 w-full rounded-[var(--omnix-radius-sm)] py-2 pl-8 pr-3 text-sm sm:h-9 sm:text-xs"
            />
          </div>
          <div className="flex min-h-11 overflow-hidden rounded-[9px] border border-[var(--omnix-rgba-0-255-255-0-1)] bg-[var(--omnix-rgba-0-255-255-0-03)] sm:min-h-9">
            {(["grid", "list"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setView(mode)}
                className="flex h-11 w-12 items-center justify-center transition active:scale-[0.97] sm:h-9 sm:w-10"
                style={{
                  background: view === mode ? "var(--omnix-rgba-0-255-255-0-1)" : "transparent",
                  color: view === mode ? "var(--omnix-cyan)" : "var(--omnix-rgba-255-255-255-0-3)",
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
            onClick={scrollToUpload}
            className="inline-flex h-11 w-full items-center justify-center gap-1.5 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-cyan)] bg-transparent px-4 text-xs font-bold text-[var(--omnix-cyan)] shadow-[var(--omnix-glow-xs)] transition hover:bg-cyan-300/10 hover:shadow-[var(--omnix-glow-sm)] active:scale-[0.98] sm:h-9 sm:w-auto"
          >
            <Plus className="h-3.5 w-3.5" />
            Upload File
          </button>
        </div>

        <div id="workspace-upload-dropzone" className="omnix-cinematic-card p-4">
          <UploadDropzone onUploadSuccess={handleUploadSuccess} onUploadComplete={(result) => result.hasSuccess && void loadFiles()} />
        </div>

        <div className="omnix-cinematic-card p-5">
          <h2 className="relative z-10 flex items-center gap-2 text-sm font-semibold text-white">
            <FileText className="h-4 w-4 text-cyan-200" />
            {activeWorkspace?.is_shared ? "Shared files" : "Workspace files"}
          </h2>
          {loading ? (
            <div className="relative z-10 mt-4 grid gap-2">
              {[0, 1, 2].map((item) => (
                <Skeleton key={item} className="h-16 rounded-lg border border-[var(--omnix-border)] bg-[var(--omnix-surface)]" />
              ))}
            </div>
          ) : error ? (
            <OmnixErrorState
              compact
              className="relative z-10 mt-4"
              title={error.startsWith("Unable to load files.") ? "Files are unavailable" : "File action needs attention"}
              message={error}
              onRetry={error.startsWith("Unable to load files.") ? () => void loadFiles() : undefined}
              isRetrying={loading}
              onDismiss={() => setError(null)}
            />
          ) : files.length === 0 ? (
            <EmptyState
              icon={FileUp}
              title="No files uploaded yet"
              description="Upload a PDF, DOCX, TXT, or Markdown file above to make it available to Omnix retrieval."
              action={{ label: "Upload first file", onClick: scrollToUpload }}
              className="relative z-10 mt-4 min-h-[220px] border-dashed"
            />
          ) : filteredFiles.length === 0 ? (
            <EmptyState
              icon={Search}
              title="No sources match this search"
              description="Clear the search field to view all uploaded workspace files."
              action={{ label: "Clear search", onClick: () => setSearchQuery("") }}
              className="relative z-10 mt-4 min-h-[180px] border-dashed"
            />
          ) : shouldVirtualizeFiles ? (
            <div
              ref={fileResultsRef}
              className="omnix-scrollbar relative z-10 mt-3 max-h-[min(72dvh,44rem)] overflow-y-auto pr-1"
              data-virtualized="true"
            >
              <div className="relative w-full" style={{ height: fileVirtualizer.getTotalSize() }}>
                {fileVirtualizer.getVirtualItems().map((virtualRow) => {
                  const row = virtualFileRows[virtualRow.index] ?? [];
                  return (
                    <div
                      key={virtualRow.key}
                      data-index={virtualRow.index}
                      ref={fileVirtualizer.measureElement}
                      className={view === "grid" ? "absolute left-0 top-0 grid w-full gap-3 pb-3 md:grid-cols-2 xl:grid-cols-3" : "absolute left-0 top-0 grid w-full gap-2 pb-2"}
                      style={{ transform: `translateY(${virtualRow.start}px)` }}
                    >
                      {row.map((file) => renderFileCard(file))}
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <div
              ref={fileResultsRef}
              className={view === "grid" ? "relative z-10 mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "relative z-10 mt-3 grid gap-2"}
            >
              {filteredFiles.map((file) => renderFileCard(file))}
            </div>
          )}
        </div>
        </>
        ) : null}
      </div>

      {candidateFile ? (
        <DocumentPortal>
          <div className="fixed inset-0 z-[155] flex items-end justify-center bg-black/70 px-3 py-4 backdrop-blur-md sm:items-center">
            <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[linear-gradient(180deg,var(--omnix-rgba-12-18-28-0-98),var(--omnix-rgba-3-6-12-0-98))] p-4 shadow-2xl sm:rounded-2xl sm:p-5">
              <div className="mb-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-cyan-100/70">Document suggestions</p>
                  <h3 className="mt-1 truncate text-base font-semibold text-white">{candidateFile.file_name ?? candidateFile.filename ?? "Document"}</h3>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setCandidateFile(null);
                    setDecisionCandidates([]);
                    setDecisionCandidatesError(null);
                  }}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white"
                  aria-label="Close document decision suggestions"
                  title="Close"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <DecisionCandidatePanel
                collapsed={false}
                candidates={decisionCandidates}
                loading={decisionCandidatesLoading}
                error={decisionCandidatesError}
                emptyText="No evidence-backed document decisions found."
                onToggle={() => undefined}
                onRefresh={() => void scanDocumentDecisionCandidates(candidateFile)}
                onCreate={(candidate) => void openCandidateDecision(candidate)}
                onDismiss={(candidate) => void dismissDecisionCandidate(candidate)}
              />
            </div>
          </div>
        </DocumentPortal>
      ) : null}

      {activeWorkspaceId && decisionCandidateDraft ? (
        <CreateDecisionModal
          workspaceId={activeWorkspaceId}
          initialValues={decisionCandidateDraft}
          onClose={() => setDecisionCandidateDraft(null)}
          onSuccess={() => {
            setDecisionCandidateDraft(null);
            setCandidateFile(null);
            setDecisionCandidates([]);
          }}
        />
      ) : null}

      {setupType && setupMeta ? (
        <ConnectorSetupModal
          setupType={setupType}
          setupMeta={setupMeta}
          setupForm={setupForm}
          setSetupForm={setSetupForm}
          setupMessage={setupMessage}
          savingConnector={savingConnector}
          onClose={() => setSetupType(null)}
          onSave={() => void handleSaveConnector()}
          onDriveAuth={() => void handleDriveAuth()}
        />
      ) : null}
    </section>
  );
}
