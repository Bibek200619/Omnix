"use client";

import { Suspense } from "react";
import { PageSkeleton } from "@/components/ui/PageSkeleton";
import dynamic from "next/dynamic";
import type { CSSProperties, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertCircle,
  BadgeCheck,
  CheckCircle2,
  Clock3,
  Database,
  Download,
  ExternalLink,
  FileText,
  FileUp,
  GitBranch,
  HardDrive,
  LayoutGrid,
  Link2,
  List,
  LockKeyhole,
  Plus,
  RefreshCw,
  Search,
  Server,
  Trash2,
  Unplug,
  X,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { CreateDecisionModal } from "@/components/decisions/CreateDecisionModal";
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
import type { DecisionCandidate, DecisionCandidateList, WorkspaceDecisionStatus } from "@/lib/workspace-types";

const UploadDropzone = dynamic(() => import("@/components/upload/UploadDropzone").then((m) => m.UploadDropzone), { ssr: false });

function DocumentPortal({ children }: { children: ReactNode }) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  if (!mounted) return null;

  return createPortal(children, document.body);
}

interface FileData {
  id: string;
  file_name?: string;
  filename?: string;
  file_type?: string;
  content_type?: string;
  size_bytes?: number;
  storage_path?: string;
  metadata?: Record<string, unknown> | null;
  page_count?: number | null;
  extractor_used?: string | null;
  extracted_character_count?: number | null;
  image_page_count?: number | null;
  text_page_count?: number | null;
  extraction_status?: "processing" | "searchable" | "ocr_required" | "extraction_failed" | null;
  extraction_failure_reason?: string | null;
  ocr_used?: boolean | null;
  ocr_character_count?: number | null;
}

type ConnectorType = "knowledge_link" | "file_repository" | "company_drive" | "external_database";
type SourceType = "file" | ConnectorType;
type SourceSection = "files" | "connectors";

type ConnectorStatus =
  | "live"
  | "connecting"
  | "connected"
  | "syncing"
  | "failed"
  | "pending_ingestion"
  | "request_submitted"
  | "needs_authentication";

type ConnectorJob = {
  id: string;
  type?: string | null;
  status?: string | null;
  progress?: number | null;
  attempts?: number | null;
  error?: string | null;
  created_at?: string | null;
};

type WorkspaceConnector = {
  id: string;
  workspace_id: string;
  user_id: string;
  connector_type: ConnectorType;
  display_name: string;
  status: ConnectorStatus;
  config: Record<string, unknown>;
  last_error?: string | null;
  job_id?: string | null;
  source_file_id?: string | null;
  last_synced_at?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  job?: ConnectorJob | null;
};

type ConnectorFormState = {
  displayName: string;
  url: string;
  repository: string;
  branch: string;
  authMode: "none" | "token_reference" | "ssh_key_reference" | "needs_setup";
  credentialReference: string;
  provider: string;
  engine: "postgres" | "mysql" | "mssql" | "snowflake" | "bigquery" | "redshift" | "other";
  host: string;
  port: string;
  database: string;
  schema: string;
  dbAuthMode: "credential_reference" | "iam" | "oauth" | "network_allowlist" | "needs_setup";
  notes: string;
};

const sourceTypes: Array<{
  id: SourceType;
  title: string;
  description: string;
  icon: typeof FileText;
  color: string;
  surface: string;
  border: string;
  activeSurface: string;
  activeBorder: string;
  iconSurface: string;
  iconBorder: string;
  shadow: string;
  action: string;
}> = [
  {
    id: "file",
    title: "File upload",
    description: "PDF, DOCX, TXT, Markdown",
    icon: FileUp,
    color: "var(--omnix-cyan)",
    surface: "var(--omnix-rgba-255-255-255-0-025)",
    border: "var(--omnix-rgba-255-255-255-0-07)",
    activeSurface: "var(--omnix-rgba-0-255-255-0-12)",
    activeBorder: "var(--omnix-rgba-0-255-255-0-55)",
    iconSurface: "var(--omnix-rgba-0-255-255-0-14)",
    iconBorder: "var(--omnix-rgba-0-255-255-0-28)",
    shadow: "var(--omnix-rgba-0-255-255-0-18)",
    action: "Upload",
  },
  {
    id: "knowledge_link",
    title: "Knowledge link",
    description: "Docs, wiki, or policy URL",
    icon: Link2,
    color: "var(--omnix-amber)",
    surface: "var(--omnix-rgba-255-255-255-0-025)",
    border: "var(--omnix-rgba-255-255-255-0-07)",
    activeSurface: "var(--omnix-rgba-255-184-0-12)",
    activeBorder: "var(--omnix-rgba-255-184-0-55)",
    iconSurface: "var(--omnix-rgba-255-184-0-14)",
    iconBorder: "var(--omnix-rgba-255-184-0-28)",
    shadow: "var(--omnix-rgba-255-184-0-18)",
    action: "Sync link",
  },
  {
    id: "file_repository",
    title: "File repository",
    description: "Git URL or internal repo path",
    icon: GitBranch,
    color: "var(--omnix-pink)",
    surface: "var(--omnix-rgba-255-255-255-0-025)",
    border: "var(--omnix-rgba-255-255-255-0-07)",
    activeSurface: "var(--omnix-rgba-255-77-244-0-12)",
    activeBorder: "var(--omnix-rgba-255-77-244-0-55)",
    iconSurface: "var(--omnix-rgba-255-77-244-0-14)",
    iconBorder: "var(--omnix-rgba-255-77-244-0-28)",
    shadow: "var(--omnix-rgba-255-77-244-0-18)",
    action: "Set up",
  },
  {
    id: "company_drive",
    title: "Company drive link",
    description: "Shared Drive, SharePoint, or folder URL",
    icon: HardDrive,
    color: "var(--omnix-purple)",
    surface: "var(--omnix-rgba-255-255-255-0-025)",
    border: "var(--omnix-rgba-255-255-255-0-07)",
    activeSurface: "var(--omnix-rgba-155-92-255-0-12)",
    activeBorder: "var(--omnix-rgba-155-92-255-0-55)",
    iconSurface: "var(--omnix-rgba-155-92-255-0-14)",
    iconBorder: "var(--omnix-rgba-155-92-255-0-28)",
    shadow: "var(--omnix-rgba-155-92-255-0-18)",
    action: "Connect",
  },
  {
    id: "external_database",
    title: "External database",
    description: "Structured connection request",
    icon: Server,
    color: "var(--omnix-green)",
    surface: "var(--omnix-rgba-255-255-255-0-025)",
    border: "var(--omnix-rgba-255-255-255-0-07)",
    activeSurface: "var(--omnix-rgba-0-232-122-0-12)",
    activeBorder: "var(--omnix-rgba-0-232-122-0-55)",
    iconSurface: "var(--omnix-rgba-0-232-122-0-14)",
    iconBorder: "var(--omnix-rgba-0-232-122-0-28)",
    shadow: "var(--omnix-rgba-0-232-122-0-18)",
    action: "Request",
  },
];

const statusLabel: Record<ConnectorStatus | "not_configured", string> = {
  live: "Live",
  connecting: "Connecting",
  connected: "Connected",
  syncing: "Syncing",
  failed: "Failed",
  pending_ingestion: "Pending Ingestion",
  request_submitted: "Request Submitted",
  needs_authentication: "Needs Authentication",
  not_configured: "Not Configured",
};

const statusStyle: Record<ConnectorStatus | "not_configured", string> = {
  live: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  connecting: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  connected: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  syncing: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  failed: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  pending_ingestion: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  request_submitted: "border-violet-300/25 bg-violet-300/10 text-violet-100",
  needs_authentication: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  not_configured: "border-white/10 bg-white/[0.04] text-white/45",
};

type FileIngestionStatus = "searchable" | "processing" | "ocr_required" | "ocr_complete" | "extraction_failed";

const fileStatusStyle: Record<FileIngestionStatus, string> = {
  searchable: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  processing: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  ocr_required: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  ocr_complete: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  extraction_failed: "border-rose-300/30 bg-rose-300/10 text-rose-100",
};

const fileStatusLabel: Record<FileIngestionStatus, string> = {
  searchable: "Searchable",
  processing: "Processing",
  ocr_required: "OCR Required",
  ocr_complete: "OCR Complete",
  extraction_failed: "Extraction Failed",
};

function formatFileSize(size?: number) {
  if (!size) return "Unknown size";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(value?: string | null) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function metadataValue(file: FileData, key: string) {
  return file.metadata && typeof file.metadata === "object" ? file.metadata[key] : undefined;
}

function numberDiagnostic(file: FileData, key: keyof FileData) {
  const direct = file[key];
  if (typeof direct === "number") return direct;
  const fromMetadata = metadataValue(file, String(key));
  return typeof fromMetadata === "number" ? fromMetadata : undefined;
}

function stringDiagnostic(file: FileData, key: keyof FileData | string) {
  const direct = key in file ? file[key as keyof FileData] : undefined;
  if (typeof direct === "string") return direct;
  const fromMetadata = metadataValue(file, String(key));
  return typeof fromMetadata === "string" ? fromMetadata : undefined;
}

function booleanDiagnostic(file: FileData, key: keyof FileData) {
  const direct = file[key];
  if (typeof direct === "boolean") return direct;
  const fromMetadata = metadataValue(file, String(key));
  return typeof fromMetadata === "boolean" ? fromMetadata : false;
}

function fileIngestionStatus(file: FileData): FileIngestionStatus {
  const status = stringDiagnostic(file, "extraction_status");
  const ocrUsed = booleanDiagnostic(file, "ocr_used");
  const ocrChars = numberDiagnostic(file, "ocr_character_count") ?? 0;
  if (status === "searchable" && ocrUsed && ocrChars > 0) return "ocr_complete";
  if (status === "processing" || status === "ocr_required" || status === "extraction_failed" || status === "searchable") return status;
  return (numberDiagnostic(file, "extracted_character_count") ?? 0) > 0 ? "searchable" : "processing";
}

function fileStatusDetail(file: FileData) {
  const status = fileIngestionStatus(file);
  const reason = stringDiagnostic(file, "extraction_failure_reason") || stringDiagnostic(file, "extraction_error");
  if (reason && status !== "searchable" && status !== "ocr_complete") return reason;
  const extractedChars = numberDiagnostic(file, "extracted_character_count") ?? 0;
  const ocrChars = numberDiagnostic(file, "ocr_character_count") ?? 0;
  const pages = numberDiagnostic(file, "page_count");
  if (status === "processing") return "Text extraction is still running.";
  if (status === "ocr_required") return "This PDF contains no readable text layer. OCR is required before it becomes searchable.";
  if (status === "extraction_failed") return "Text extraction failed for this document.";
  if (status === "ocr_complete") return `OCR extracted ${ocrChars.toLocaleString()} characters${pages ? ` across ${pages} pages` : ""}.`;
  return `Extracted ${extractedChars.toLocaleString()} characters${pages ? ` across ${pages} pages` : ""}.`;
}

function connectorIcon(type: ConnectorType) {
  return sourceTypes.find((item) => item.id === type)?.icon ?? Database;
}

function connectorAccent(type: ConnectorType) {
  return sourceTypes.find((item) => item.id === type) ?? sourceTypes[0];
}

function emptyForm(type: ConnectorType): ConnectorFormState {
  return {
    displayName: "",
    url: "",
    repository: "",
    branch: "",
    authMode: "none",
    credentialReference: "",
    provider: type === "company_drive" ? "auto" : "",
    engine: "postgres",
    host: "",
    port: "",
    database: "",
    schema: "",
    dbAuthMode: "credential_reference",
    notes: "",
  };
}

function valueFromConfig(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

function formFromConnector(type: ConnectorType, connector?: WorkspaceConnector): ConnectorFormState {
  const form = emptyForm(type);
  if (!connector) return form;
  const config = connector.config || {};
  return {
    ...form,
    displayName: connector.display_name || "",
    url: valueFromConfig(config, "url"),
    repository: valueFromConfig(config, "repository"),
    branch: valueFromConfig(config, "branch"),
    authMode: (valueFromConfig(config, "auth_mode") as ConnectorFormState["authMode"]) || form.authMode,
    credentialReference: valueFromConfig(config, "credential_reference"),
    provider: valueFromConfig(config, "provider") || form.provider,
    engine: (valueFromConfig(config, "engine") as ConnectorFormState["engine"]) || form.engine,
    host: valueFromConfig(config, "host"),
    port: valueFromConfig(config, "port"),
    database: valueFromConfig(config, "database"),
    schema: valueFromConfig(config, "schema"),
    dbAuthMode: (valueFromConfig(config, "auth_mode") as ConnectorFormState["dbAuthMode"]) || form.dbAuthMode,
    notes: valueFromConfig(config, "notes"),
  };
}

function connectorSummary(connector: WorkspaceConnector) {
  const config = connector.config || {};
  if (connector.connector_type === "knowledge_link" || connector.connector_type === "company_drive") {
    return valueFromConfig(config, "url") || "No URL saved";
  }
  if (connector.connector_type === "file_repository") {
    return valueFromConfig(config, "repository") || "No repository saved";
  }
  const engine = valueFromConfig(config, "engine").toUpperCase() || "Database";
  const host = valueFromConfig(config, "host");
  const database = valueFromConfig(config, "database");
  return [engine, host, database].filter(Boolean).join(" / ") || "Connection details saved";
}

function newestConnector(connectors: WorkspaceConnector[], type: ConnectorType) {
  return connectors
    .filter((connector) => connector.connector_type === type)
    .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))[0];
}

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
  } | null>(null);
  const workspaceMembers = activeMembers.length > 0 ? activeMembers : activeWorkspace?.members_preview ?? [];

  const filteredFiles = files.filter((file) => {
    const name = file.file_name ?? file.filename ?? "";
    const type = file.file_type ?? file.content_type ?? "";
    const query = searchQuery.toLowerCase();
    return name.toLowerCase().includes(query) || type.toLowerCase().includes(query);
  });

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
          ) : (
            <div className={view === "grid" ? "relative z-10 mt-3 grid gap-3 md:grid-cols-2 xl:grid-cols-3" : "relative z-10 mt-3 grid gap-2"}>
              {filteredFiles.map((f) => {
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
              })}
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
        <DocumentPortal>
        <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/70 px-3 py-4 backdrop-blur-md sm:items-center">
          <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[linear-gradient(180deg,var(--omnix-rgba-12-18-28-0-98),var(--omnix-rgba-3-6-12-0-98))] p-5 shadow-2xl sm:rounded-2xl sm:p-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ background: setupMeta.iconSurface, borderColor: setupMeta.iconBorder, color: setupMeta.color }}>
                  <setupMeta.icon className="h-5 w-5" />
                </span>
                <div className="min-w-0">
                  <h3 className="omnix-display text-lg font-semibold text-white">{setupMeta.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-3)]">{setupMeta.description}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSetupType(null)}
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/50 transition hover:bg-white/[0.08] hover:text-white"
                aria-label="Close connector setup"
                title="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="mt-5 grid gap-4">
              <label className="grid gap-2 text-xs font-medium text-white/60">
                Display name
                <input
                  value={setupForm.displayName}
                  onChange={(event) => setSetupForm((current) => ({ ...current, displayName: event.target.value }))}
                  placeholder="Optional workspace-facing name"
                  className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                />
              </label>

              {setupType === "knowledge_link" ? (
                <ConnectorUrlField
                  label="Knowledge URL"
                  value={setupForm.url}
                  placeholder="https://company.example.com/handbook/security-policy"
                  onChange={(url) => setSetupForm((current) => ({ ...current, url }))}
                />
              ) : null}

              {setupType === "file_repository" ? (
                <>
                  <label className="grid gap-2 text-xs font-medium text-white/60">
                    Repository URL or path
                    <input
                      value={setupForm.repository}
                      onChange={(event) => setSetupForm((current) => ({ ...current, repository: event.target.value }))}
                      placeholder="https://github.com/company/repo or //repos/platform"
                      className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                    />
                  </label>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2 text-xs font-medium text-white/60">
                      Branch or path scope
                      <input
                        value={setupForm.branch}
                        onChange={(event) => setSetupForm((current) => ({ ...current, branch: event.target.value }))}
                        placeholder="main, docs/, or runbooks/"
                        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                      />
                    </label>
                    <label className="grid gap-2 text-xs font-medium text-white/60">
                      Authentication
                      <select
                        value={setupForm.authMode}
                        onChange={(event) => setSetupForm((current) => ({ ...current, authMode: event.target.value as ConnectorFormState["authMode"] }))}
                        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                      >
                        <option value="none">No auth required</option>
                        <option value="token_reference">Token reference</option>
                        <option value="ssh_key_reference">SSH key reference</option>
                        <option value="needs_setup">Needs setup</option>
                      </select>
                    </label>
                  </div>
                </>
              ) : null}

              {setupType === "company_drive" ? (
                <>
                  <ConnectorUrlField
                    label="Drive or folder URL"
                    value={setupForm.url}
                    placeholder="https://drive.google.com/drive/folders/..."
                    onChange={(url) => setSetupForm((current) => ({ ...current, url }))}
                  />
                  <label className="grid gap-2 text-xs font-medium text-white/60">
                    Provider
                    <select
                      value={setupForm.provider}
                      onChange={(event) => setSetupForm((current) => ({ ...current, provider: event.target.value }))}
                      className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                    >
                      <option value="auto">Detect from URL</option>
                      <option value="google_drive">Google Drive</option>
                      <option value="sharepoint">SharePoint</option>
                      <option value="onedrive">OneDrive</option>
                      <option value="shared_drive">Other shared drive</option>
                    </select>
                  </label>
                </>
              ) : null}

              {setupType === "external_database" ? (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2 text-xs font-medium text-white/60">
                      Engine
                      <select
                        value={setupForm.engine}
                        onChange={(event) => setSetupForm((current) => ({ ...current, engine: event.target.value as ConnectorFormState["engine"] }))}
                        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                      >
                        <option value="postgres">Postgres</option>
                        <option value="mysql">MySQL</option>
                        <option value="mssql">SQL Server</option>
                        <option value="snowflake">Snowflake</option>
                        <option value="bigquery">BigQuery</option>
                        <option value="redshift">Redshift</option>
                        <option value="other">Other</option>
                      </select>
                    </label>
                    <label className="grid gap-2 text-xs font-medium text-white/60">
                      Auth method
                      <select
                        value={setupForm.dbAuthMode}
                        onChange={(event) => setSetupForm((current) => ({ ...current, dbAuthMode: event.target.value as ConnectorFormState["dbAuthMode"] }))}
                        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                      >
                        <option value="credential_reference">Credential reference</option>
                        <option value="iam">IAM or service account</option>
                        <option value="oauth">OAuth</option>
                        <option value="network_allowlist">Network allowlist</option>
                        <option value="needs_setup">Needs setup</option>
                      </select>
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_7rem]">
                    <label className="grid gap-2 text-xs font-medium text-white/60">
                      Host
                      <input
                        value={setupForm.host}
                        onChange={(event) => setSetupForm((current) => ({ ...current, host: event.target.value }))}
                        placeholder="warehouse.company.internal"
                        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                      />
                    </label>
                    <label className="grid gap-2 text-xs font-medium text-white/60">
                      Port
                      <input
                        value={setupForm.port}
                        onChange={(event) => setSetupForm((current) => ({ ...current, port: event.target.value }))}
                        placeholder="5432"
                        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                      />
                    </label>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="grid gap-2 text-xs font-medium text-white/60">
                      Database
                      <input
                        value={setupForm.database}
                        onChange={(event) => setSetupForm((current) => ({ ...current, database: event.target.value }))}
                        placeholder="analytics"
                        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                      />
                    </label>
                    <label className="grid gap-2 text-xs font-medium text-white/60">
                      Schema or tables
                      <input
                        value={setupForm.schema}
                        onChange={(event) => setSetupForm((current) => ({ ...current, schema: event.target.value }))}
                        placeholder="public.docs, policies"
                        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                      />
                    </label>
                  </div>
                </>
              ) : null}

              {(setupType === "file_repository" || setupType === "external_database") ? (
                <label className="grid gap-2 text-xs font-medium text-white/60">
                  Credential reference
                  <input
                    value={setupForm.credentialReference}
                    onChange={(event) => setSetupForm((current) => ({ ...current, credentialReference: event.target.value }))}
                    placeholder="Vault path, secret alias, or ticket reference. Do not paste raw passwords."
                    className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
                  />
                </label>
              ) : null}

              <label className="grid gap-2 text-xs font-medium text-white/60">
                Access notes
                <textarea
                  value={setupForm.notes}
                  onChange={(event) => setSetupForm((current) => ({ ...current, notes: event.target.value }))}
                  rows={4}
                  placeholder="Folder scope, access constraints, schema scope, or ingestion instructions"
                  className="omnix-input min-h-[96px] w-full resize-none rounded-lg px-3 py-2 text-sm"
                />
              </label>

              {setupType === "company_drive" && (setupForm.provider === "google_drive" || setupForm.url.includes("drive.google.com")) ? (
                <div className="rounded-xl border border-amber-300/20 bg-amber-300/10 p-3 text-sm leading-6 text-amber-50/85">
                  Google Drive folder setup may require OAuth before Omnix can validate access.
                  <button type="button" onClick={() => void handleDriveAuth()} className="ml-2 inline-flex font-semibold text-amber-100 underline underline-offset-4">
                    Start authentication
                  </button>
                </div>
              ) : null}

              {setupMessage ? (
                <div className="rounded-lg border border-amber-300/20 bg-amber-300/10 px-3 py-2 text-sm text-amber-50">
                  {setupMessage}
                </div>
              ) : null}

              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" onClick={() => setSetupType(null)}>Cancel</Button>
                <Button
                  type="button"
                  variant="secondary"
                  className="border-cyan-300/20 text-cyan-100"
                  leftIcon={setupType === "knowledge_link" ? <CheckCircle2 className="h-4 w-4" /> : setupType === "external_database" ? <LockKeyhole className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                  isLoading={savingConnector}
                  onClick={() => void handleSaveConnector()}
                >
                  {setupType === "knowledge_link" ? "Save and sync" : "Save setup"}
                </Button>
              </div>

              {setupType !== "knowledge_link" ? (
                <div className="flex items-start gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-3 text-[12px] leading-5 text-white/50">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-amber-200/70" />
                  This connector setup is persisted now. Ingestion remains in request state until the matching backend importer is available.
                </div>
              ) : null}
            </div>
          </div>
        </div>
        </DocumentPortal>
      ) : null}
    </section>
  );
}

function ConnectorUrlField({
  label,
  value,
  placeholder,
  onChange,
}: {
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-2 text-xs font-medium text-white/60">
      {label}
      <input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder={placeholder}
        className="omnix-input min-h-[44px] w-full rounded-lg px-3 text-sm"
      />
    </label>
  );
}
