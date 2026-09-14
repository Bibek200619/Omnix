import type { LucideIcon } from "lucide-react";
import { Database, FileUp, GitBranch, HardDrive, Link2, Server } from "lucide-react";

export type FileProcessingStatus =
  | "uploaded"
  | "queued"
  | "extracting"
  | "chunking"
  | "embedding"
  | "ocr_required"
  | "ocr_running"
  | "searchable"
  | "partially_searchable"
  | "failed"
  // Legacy values remain supported while older rows are migrated.
  | "processing"
  | "extracted"
  | "chunked"
  | "embedded";
export type FileIngestionStatus = FileProcessingStatus | "ocr_complete" | "extraction_failed";

export interface FileData {
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
  processing_status?: FileProcessingStatus | null;
  processing_error?: string | null;
  processing_job_id?: string | null;
  ocr_used?: boolean | null;
  ocr_character_count?: number | null;
  ocr_pages_processed?: number | null;
  ocr_pages_omitted?: number | null;
  ocr_coverage_complete?: boolean | null;
}

export type ConnectorType = "knowledge_link" | "file_repository" | "company_drive" | "external_database";
export type SourceType = "file" | ConnectorType;
export type SourceSection = "files" | "connectors";

export type ConnectorStatus =
  | "live"
  | "connecting"
  | "connected"
  | "syncing"
  | "failed"
  | "pending_ingestion"
  | "request_submitted"
  | "needs_authentication";

export type ConnectorJob = {
  id: string;
  type?: string | null;
  status?: string | null;
  progress?: number | null;
  attempts?: number | null;
  error?: string | null;
  created_at?: string | null;
};

export type WorkspaceConnector = {
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

export type ConnectorFormState = {
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

export type SourceTypeMeta = {
  id: SourceType;
  title: string;
  description: string;
  icon: LucideIcon;
  color: string;
  surface: string;
  border: string;
  activeSurface: string;
  activeBorder: string;
  iconSurface: string;
  iconBorder: string;
  shadow: string;
  action: string;
};

export const sourceTypes: SourceTypeMeta[] = [
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

export const statusLabel: Record<ConnectorStatus | "not_configured", string> = {
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

export const statusStyle: Record<ConnectorStatus | "not_configured", string> = {
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

export const fileStatusStyle: Record<FileIngestionStatus, string> = {
  uploaded: "border-white/10 bg-white/[0.04] text-white/55",
  queued: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  searchable: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  partially_searchable: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  processing: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  extracting: "border-cyan-300/25 bg-cyan-300/10 text-cyan-100",
  extracted: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  chunking: "border-teal-300/25 bg-teal-300/10 text-teal-100",
  chunked: "border-teal-300/25 bg-teal-300/10 text-teal-100",
  embedding: "border-sky-300/25 bg-sky-300/10 text-sky-100",
  embedded: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  failed: "border-rose-300/30 bg-rose-300/10 text-rose-100",
  ocr_required: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  ocr_running: "border-amber-300/25 bg-amber-300/10 text-amber-100",
  ocr_complete: "border-emerald-300/25 bg-emerald-300/10 text-emerald-200",
  extraction_failed: "border-rose-300/30 bg-rose-300/10 text-rose-100",
};

export const fileStatusLabel: Record<FileIngestionStatus, string> = {
  uploaded: "Uploaded",
  queued: "Queued",
  searchable: "Searchable",
  partially_searchable: "Partially Searchable",
  processing: "Processing",
  extracting: "Extracting",
  extracted: "Extracted",
  chunking: "Chunking",
  chunked: "Chunked",
  embedding: "Embedding",
  embedded: "Embedded",
  failed: "Failed",
  ocr_required: "OCR Required",
  ocr_running: "Running OCR",
  ocr_complete: "OCR Complete",
  extraction_failed: "Extraction Failed",
};

export function formatFileSize(size?: number) {
  if (!size) return "Unknown size";
  if (size < 1024 * 1024) return `${Math.max(1, Math.round(size / 1024))} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatDate(value?: string | null) {
  if (!value) return "Not synced yet";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not synced yet";
  return date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

export function metadataValue(file: FileData, key: string) {
  return file.metadata && typeof file.metadata === "object" ? file.metadata[key] : undefined;
}

export function numberDiagnostic(file: FileData, key: keyof FileData) {
  const direct = file[key];
  if (typeof direct === "number") return direct;
  const fromMetadata = metadataValue(file, String(key));
  return typeof fromMetadata === "number" ? fromMetadata : undefined;
}

export function stringDiagnostic(file: FileData, key: keyof FileData | string) {
  const direct = key in file ? file[key as keyof FileData] : undefined;
  if (typeof direct === "string") return direct;
  const fromMetadata = metadataValue(file, String(key));
  return typeof fromMetadata === "string" ? fromMetadata : undefined;
}

export function booleanDiagnostic(file: FileData, key: keyof FileData) {
  const direct = file[key];
  if (typeof direct === "boolean") return direct;
  const fromMetadata = metadataValue(file, String(key));
  return typeof fromMetadata === "boolean" ? fromMetadata : false;
}

function isFileIngestionStatus(value: string): value is FileIngestionStatus {
  return Object.prototype.hasOwnProperty.call(fileStatusStyle, value);
}

export function fileIngestionStatus(file: FileData): FileIngestionStatus {
  const processingStatus = stringDiagnostic(file, "processing_status");
  if (processingStatus && isFileIngestionStatus(processingStatus)) {
    return processingStatus;
  }

  const status = stringDiagnostic(file, "extraction_status");
  const ocrUsed = booleanDiagnostic(file, "ocr_used");
  const ocrChars = numberDiagnostic(file, "ocr_character_count") ?? 0;
  if (status === "searchable" && ocrUsed && ocrChars > 0) return "ocr_complete";
  if (status === "processing" || status === "ocr_required" || status === "extraction_failed" || status === "searchable") return status;
  return (numberDiagnostic(file, "extracted_character_count") ?? 0) > 0 ? "searchable" : "processing";
}

export function fileStatusDetail(file: FileData) {
  const status = fileIngestionStatus(file);
  const reason =
    stringDiagnostic(file, "processing_error") ||
    stringDiagnostic(file, "extraction_failure_reason") ||
    stringDiagnostic(file, "extraction_error");
  if (reason && status !== "searchable" && status !== "ocr_complete") return reason;
  const extractedChars = numberDiagnostic(file, "extracted_character_count") ?? 0;
  const ocrChars = numberDiagnostic(file, "ocr_character_count") ?? 0;
  const pages = numberDiagnostic(file, "page_count");
  const ocrPagesProcessed = numberDiagnostic(file, "ocr_pages_processed");
  const ocrPagesOmitted = numberDiagnostic(file, "ocr_pages_omitted");
  const omittedOcrPages = ocrPagesOmitted ?? 0;
  const ocrCoverageComplete = booleanDiagnostic(file, "ocr_coverage_complete");
  const ocrUsed = booleanDiagnostic(file, "ocr_used");
  if (status === "uploaded") return "The file is stored and waiting to be queued for processing.";
  if (status === "queued") return "Processing is queued. Omnix will extract, chunk, and embed this source in the background.";
  if (status === "processing" || status === "extracting") return "Text extraction is still running.";
  if (status === "extracted" || status === "chunking") return `Extracted ${extractedChars.toLocaleString()} characters; chunking is next.`;
  if (status === "chunked" || status === "embedding") return `Text chunks are ready${extractedChars ? ` from ${extractedChars.toLocaleString()} characters` : ""}; embeddings are still finishing.`;
  if (status === "embedded") return `Fully indexed for retrieval${extractedChars ? ` from ${extractedChars.toLocaleString()} characters` : ""}${pages ? ` across ${pages} pages` : ""}.`;
  if (status === "failed") return "File processing failed.";
  if (status === "partially_searchable") return "Text chunks are available, but vector indexing is incomplete. Omnix will retry processing this source.";
  if (status === "ocr_required") return "This PDF contains no readable text layer. OCR is required before it becomes searchable.";
  if (status === "ocr_running") return "OCR is running before this source can be indexed.";
  if (status === "extraction_failed") return "Text extraction failed for this document.";
  if ((status === "searchable" || status === "ocr_complete") && ocrUsed && ocrChars > 0) {
    if (ocrPagesProcessed === undefined) {
      return `OCR extracted ${ocrChars.toLocaleString()} characters. Page coverage was not recorded for this older import.`;
    }
    if (omittedOcrPages > 0) {
      const pageCoverage = pages ? `the first ${ocrPagesProcessed.toLocaleString()} of ${pages.toLocaleString()}` : ocrPagesProcessed.toLocaleString();
      return `OCR indexed ${pageCoverage} pages and extracted ${ocrChars.toLocaleString()} characters. ${omittedOcrPages.toLocaleString()} pages were not processed because of the OCR limit.`;
    }
    if (ocrCoverageComplete) {
      return `OCR extracted ${ocrChars.toLocaleString()} characters from all ${pages?.toLocaleString() ?? ocrPagesProcessed.toLocaleString()} pages.`;
    }
    return `OCR extracted ${ocrChars.toLocaleString()} characters from ${ocrPagesProcessed.toLocaleString()} OCR-processed pages.`;
  }
  if (status === "ocr_complete") return `OCR extracted ${ocrChars.toLocaleString()} characters${pages ? ` across ${pages} pages` : ""}.`;
  return `Extracted ${extractedChars.toLocaleString()} characters${pages ? ` across ${pages} pages` : ""}.`;
}

export function connectorIcon(type: ConnectorType) {
  return sourceTypes.find((item) => item.id === type)?.icon ?? Database;
}

export function connectorAccent(type: ConnectorType) {
  return sourceTypes.find((item) => item.id === type) ?? sourceTypes[0];
}

export function emptyForm(type: ConnectorType): ConnectorFormState {
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

export function valueFromConfig(config: Record<string, unknown>, key: string) {
  const value = config[key];
  return typeof value === "string" ? value : "";
}

export function formFromConnector(type: ConnectorType, connector?: WorkspaceConnector): ConnectorFormState {
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

export function connectorSummary(connector: WorkspaceConnector) {
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

export function newestConnector(connectors: WorkspaceConnector[], type: ConnectorType) {
  return connectors
    .filter((connector) => connector.connector_type === type)
    .sort((a, b) => Date.parse(b.created_at || "") - Date.parse(a.created_at || ""))[0];
}
