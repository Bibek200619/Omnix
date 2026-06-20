"use client";

import type { Dispatch, SetStateAction } from "react";
import { AlertCircle, CheckCircle2, Clock3, LockKeyhole, X } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { DocumentPortal } from "@/components/files/DocumentPortal";
import type { ConnectorFormState, ConnectorType, SourceTypeMeta } from "@/components/files/filesPageModel";

type ConnectorSetupModalProps = {
  setupType: ConnectorType;
  setupMeta: SourceTypeMeta;
  setupForm: ConnectorFormState;
  setSetupForm: Dispatch<SetStateAction<ConnectorFormState>>;
  setupMessage: string | null;
  savingConnector: boolean;
  onClose: () => void;
  onSave: () => void;
  onDriveAuth: () => void;
};

export function ConnectorSetupModal({
  setupType,
  setupMeta,
  setupForm,
  setSetupForm,
  setupMessage,
  savingConnector,
  onClose,
  onSave,
  onDriveAuth,
}: ConnectorSetupModalProps) {
  const SetupIcon = setupMeta.icon;

  return (
    <DocumentPortal>
      <div className="fixed inset-0 z-[160] flex items-end justify-center bg-black/70 px-3 py-4 backdrop-blur-md sm:items-center">
        <div className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-t-2xl border border-white/10 bg-[linear-gradient(180deg,var(--omnix-rgba-12-18-28-0-98),var(--omnix-rgba-3-6-12-0-98))] p-5 shadow-2xl sm:rounded-2xl sm:p-6">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border" style={{ background: setupMeta.iconSurface, borderColor: setupMeta.iconBorder, color: setupMeta.color }}>
                <SetupIcon className="h-5 w-5" />
              </span>
              <div className="min-w-0">
                <h3 className="omnix-display text-lg font-semibold text-white">{setupMeta.title}</h3>
                <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-3)]">{setupMeta.description}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
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

            {setupType === "file_repository" || setupType === "external_database" ? (
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
                <button type="button" onClick={onDriveAuth} className="ml-2 inline-flex font-semibold text-amber-100 underline underline-offset-4">
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
              <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                type="button"
                variant="secondary"
                className="border-cyan-300/20 text-cyan-100"
                leftIcon={setupType === "knowledge_link" ? <CheckCircle2 className="h-4 w-4" /> : setupType === "external_database" ? <LockKeyhole className="h-4 w-4" /> : <Clock3 className="h-4 w-4" />}
                isLoading={savingConnector}
                onClick={onSave}
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
