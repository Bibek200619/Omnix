"use client";

import { useMemo, useState } from "react";
import {
  CalendarDays,
  CheckCircle2,
  ChevronDown,
  CircleUserRound,
  Fingerprint,
  KeyRound,
  Link as LinkIcon,
  LogOut,
  Mail,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { SettingsShell } from "@/components/settings/SettingsShell";
import { Alert } from "@/components/ui/Alert";
import { Button } from "@/components/ui/Button";
import { useAuth } from "@/lib/auth-context";
import { logClientError } from "@/lib/errors";
import { useProfile } from "@/lib/profile-context";
import { cn } from "@/lib/utils";
import { useWorkspaceTree } from "@/lib/workspace-context";
import { workspaceRoleBadgeClass, workspaceRoleLabel } from "@/lib/workspace-roles";

type ProviderIdentityRecord = {
  provider?: string;
  id?: string;
  identity_id?: string;
  user_id?: string;
  created_at?: string;
  last_sign_in_at?: string;
  identity_data?: unknown;
};

function metadataString(metadata: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

function metadataName(metadata?: Record<string, unknown>) {
  return metadataString(metadata, ["full_name", "name", "display_name"]);
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(date);
}

function formatDateTime(value?: string | number | null) {
  if (!value) return "Not available";
  const date = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date);
}

function providerLabel(provider?: string | null) {
  switch (String(provider || "").toLowerCase()) {
    case "email":
      return "Email and password";
    case "google":
      return "Google";
    case "github":
      return "GitHub";
    case "azure":
      return "Microsoft";
    case "saml":
      return "Enterprise SSO";
    default:
      return provider ? provider.replace(/[_-]/g, " ") : "Omnix account";
  }
}

function providerValuesFromMetadata(value: unknown) {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
  }
  return typeof value === "string" && value.trim() ? [value.trim()] : [];
}

function uniqueProviders(...groups: string[][]) {
  const providers = new Map<string, string>();
  groups.flat().forEach((provider) => {
    const normalized = provider.trim().toLowerCase();
    if (normalized && !providers.has(normalized)) providers.set(normalized, provider);
  });
  return Array.from(providers.values());
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value ?? {}, null, 2);
  } catch {
    return "{}";
  }
}

function identityKey(identity: ProviderIdentityRecord, index: number) {
  return identity.identity_id || identity.id || `${identity.provider ?? "provider"}-${index}`;
}

function StatusRow({
  icon: Icon,
  label,
  value,
  tone = "neutral",
  detail,
}: {
  icon: typeof CheckCircle2;
  label: string;
  value: string;
  tone?: "neutral" | "success" | "warning";
  detail?: string;
}) {
  return (
    <div className="flex gap-3 py-4 first:pt-0 last:pb-0">
      <span
        className={cn(
          "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border",
          tone === "success"
            ? "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
            : tone === "warning"
            ? "border-amber-300/25 bg-amber-300/10 text-amber-100"
            : "border-cyan-300/18 bg-cyan-300/8 text-cyan-100",
        )}
      >
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">{label}</p>
        <p className="mt-1 text-sm font-semibold text-white">{value}</p>
        {detail ? <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">{detail}</p> : null}
      </div>
    </div>
  );
}

export default function AccountSettingsPage() {
  const router = useRouter();
  const { session, signOut, user } = useAuth();
  const { activeWorkspace } = useWorkspaceTree();
  const { error: profileError, loading: profileLoading, profile } = useProfile();
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [advancedOpen, setAdvancedOpen] = useState(false);

  const userMetadata = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const appMetadata = (user?.app_metadata ?? {}) as Record<string, unknown>;
  const identities = useMemo(
    () => (user?.identities ?? []) as ProviderIdentityRecord[],
    [user?.identities],
  );
  const providers = useMemo(
    () =>
      uniqueProviders(
        identities.map((identity) => identity.provider ?? ""),
        providerValuesFromMetadata(appMetadata.provider),
        providerValuesFromMetadata(appMetadata.providers),
        user?.email ? ["email"] : [],
      ),
    [appMetadata.provider, appMetadata.providers, identities, user?.email],
  );
  const primaryProvider = providers[0] ?? "email";
  const displayName = profile?.display_name || metadataName(userMetadata) || user?.email || "Omnix user";
  const email = profile?.email || user?.email || "No email available";
  const handle = profile?.username || profile?.handle || "";
  const avatarUrl = profile?.avatar_url || metadataString(userMetadata, ["avatar_url", "picture"]) || null;
  const joinDate = profile?.created_at || user?.created_at || null;
  const accountVerified = Boolean(user?.email_confirmed_at || user?.confirmed_at);
  const sessionActive = Boolean(session && user);
  const sessionExpiry = session?.expires_at ? formatDateTime(session.expires_at) : "Managed automatically";
  const workspaceRole = activeWorkspace?.current_user_role;

  async function handleSignOut() {
    setSigningOut(true);
    setError(null);
    const { error: signOutError } = await signOut();
    if (signOutError) {
      logClientError("Unable to sign out", signOutError);
      setError("Unable to sign out. Check your connection and try again.");
      setSigningOut(false);
      return;
    }
    router.replace("/login");
  }

  return (
    <SettingsShell
      title="Account"
      description="Review your identity, sign-in method, account status, and security controls."
    >
      <div className="space-y-5">
        <section className="omnix-cinematic-card overflow-hidden p-5 sm:p-6">
          <div className="relative z-10 flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 flex-col gap-4 sm:flex-row sm:items-center">
              <ProfileAvatar
                name={displayName}
                email={email}
                handle={handle}
                avatarUrl={avatarUrl}
                className="h-24 w-24 border-cyan-300/30 bg-cyan-300/10 text-3xl text-cyan-50 shadow-[0_0_36px_rgba(0,255,255,0.14)]"
              />
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full border border-emerald-300/20 bg-emerald-300/10 px-3 py-1 text-xs font-semibold text-emerald-100">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {sessionActive ? "Signed in" : "Session unavailable"}
                </div>
                <h3 className="mt-3 truncate text-2xl font-semibold text-white sm:text-3xl">{displayName}</h3>
                <div className="mt-2 flex min-w-0 items-center gap-2 text-sm text-[var(--omnix-text-2)]">
                  <Mail className="h-4 w-4 shrink-0 text-cyan-100/70" />
                  <span className="truncate">{email}</span>
                </div>
                {handle ? <p className="mt-1 text-sm font-medium text-cyan-100">@{handle}</p> : null}
              </div>
            </div>

            <dl className="grid gap-4 sm:grid-cols-2 lg:min-w-[25rem]">
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Workspace role</dt>
                <dd className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex items-center rounded-full border px-3 py-1 text-xs font-semibold", workspaceRoleBadgeClass(workspaceRole))}>
                    {workspaceRoleLabel(workspaceRole)}
                  </span>
                  {activeWorkspace?.name ? <span className="min-w-0 truncate text-sm text-[var(--omnix-text-2)]">{activeWorkspace.name}</span> : null}
                </dd>
              </div>
              <div>
                <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Joined</dt>
                <dd className="mt-2 flex items-center gap-2 text-sm font-semibold text-white">
                  <CalendarDays className="h-4 w-4 text-cyan-100/75" />
                  {formatDate(joinDate)}
                </dd>
              </div>
            </dl>
          </div>
          {profileError ? (
            <Alert className="relative z-10 mt-5" variant="warning" title="Profile details could not refresh">
              {profileError}
            </Alert>
          ) : null}
          {profileLoading ? <p className="relative z-10 mt-4 text-sm text-[var(--omnix-text-3)]">Refreshing profile details...</p> : null}
        </section>

        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(22rem,0.82fr)]">
          <section className="omnix-cinematic-card p-5 sm:p-6">
            <div className="relative z-10">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-cyan-300/20 bg-cyan-300/10 text-cyan-100">
                  <CircleUserRound className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-white">Account status</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
                    The essentials for how this browser is connected to Omnix.
                  </p>
                </div>
              </div>

              <div className="mt-6 divide-y divide-[var(--omnix-border)]">
                <StatusRow
                  icon={CheckCircle2}
                  label="Signed in status"
                  value={sessionActive ? "Signed in" : "Not signed in"}
                  tone={sessionActive ? "success" : "warning"}
                  detail={sessionActive ? "Your account is active in this browser." : "This browser does not currently have an active Omnix session."}
                />
                <StatusRow
                  icon={LinkIcon}
                  label="Authentication provider"
                  value={providerLabel(primaryProvider)}
                  detail={providers.length > 1 ? `${providers.map(providerLabel).join(", ")} are connected to this account.` : "This is the provider used for account access."}
                />
                <StatusRow
                  icon={ShieldCheck}
                  label="Account state"
                  value={accountVerified ? "Verified" : "Active"}
                  tone={accountVerified ? "success" : "neutral"}
                  detail={accountVerified ? "Your email identity is confirmed." : "Your account is usable, but email confirmation details are not available here."}
                />
                <StatusRow
                  icon={KeyRound}
                  label="Session status"
                  value={sessionActive ? "Active session" : "No active session"}
                  detail={sessionActive ? `Session renewal is handled automatically. Current expiry: ${sessionExpiry}.` : "Sign in again to restore account access."}
                />
              </div>
            </div>
          </section>

          <section className="omnix-cinematic-card p-5 sm:p-6">
            <div className="relative z-10 flex h-full flex-col">
              <div className="flex items-start gap-3">
                <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-emerald-300/20 bg-emerald-300/10 text-emerald-100">
                  <ShieldCheck className="h-5 w-5" />
                </span>
                <div>
                  <h3 className="text-lg font-semibold text-white">Security</h3>
                  <p className="mt-1 text-sm leading-6 text-[var(--omnix-text-2)]">
                    Account protection controls and session actions stay grouped here.
                  </p>
                </div>
              </div>

              <div className="mt-6 divide-y divide-[var(--omnix-border)]">
                <StatusRow
                  icon={KeyRound}
                  label="Password management"
                  value={providers.some((provider) => provider.toLowerCase() === "email") ? "Email password sign-in" : "Managed by provider"}
                  detail={providers.some((provider) => provider.toLowerCase() === "email") ? "Use the sign-in recovery flow if you need to reset your password." : "Password changes are handled by your connected sign-in provider."}
                />
                <div className="py-4">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Connected providers</p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {providers.map((provider) => (
                      <span key={provider} className="inline-flex min-h-9 items-center rounded-full border border-cyan-300/18 bg-cyan-300/8 px-3 text-sm font-medium text-cyan-50">
                        {providerLabel(provider)}
                      </span>
                    ))}
                  </div>
                </div>
                <StatusRow
                  icon={CheckCircle2}
                  label="Active session"
                  value={sessionActive ? "This browser is signed in" : "Session unavailable"}
                  tone={sessionActive ? "success" : "warning"}
                  detail="Signing out only clears this browser session."
                />
              </div>

              {error ? (
                <Alert className="mt-5" variant="error" title="Unable to sign out">
                  {error}
                </Alert>
              ) : null}

              <div className="mt-6 flex flex-col gap-3 sm:flex-row xl:mt-auto xl:flex-col">
                <Button
                  type="button"
                  variant="danger"
                  className="w-full"
                  leftIcon={<LogOut className="h-4 w-4" />}
                  isLoading={signingOut}
                  disabled={!sessionActive}
                  onClick={handleSignOut}
                >
                  {signingOut ? "Signing out" : "Sign out"}
                </Button>
              </div>
            </div>
          </section>
        </div>

        <section className="omnix-cinematic-card p-5 sm:p-6">
          <div className="relative z-10">
            <button
              type="button"
              aria-expanded={advancedOpen}
              onClick={() => setAdvancedOpen((current) => !current)}
              className="flex min-h-12 w-full items-center justify-between gap-4 rounded-xl text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              <span className="flex min-w-0 items-center gap-3">
                <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/[0.04] text-slate-200">
                  <Fingerprint className="h-5 w-5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-semibold text-white">Advanced Details</span>
                  <span className="mt-1 block text-sm leading-6 text-[var(--omnix-text-2)]">
                    Technical identifiers and provider metadata for support or debugging.
                  </span>
                </span>
              </span>
              <ChevronDown className={cn("h-5 w-5 shrink-0 text-[var(--omnix-text-3)] transition", advancedOpen && "rotate-180 text-cyan-100")} />
            </button>

            {advancedOpen ? (
              <div className="mt-6 space-y-6 border-t border-[var(--omnix-border)] pt-6">
                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Auth ID</p>
                    <p className="mt-2 break-all font-mono text-sm text-slate-200">{user?.id || "Not available"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Profile user ID</p>
                    <p className="mt-2 break-all font-mono text-sm text-slate-200">{profile?.user_id || user?.id || "Not available"}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Email confirmed</p>
                    <p className="mt-2 text-sm text-slate-200">{formatDateTime(user?.email_confirmed_at || user?.confirmed_at)}</p>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Session expires</p>
                    <p className="mt-2 text-sm text-slate-200">{sessionExpiry}</p>
                  </div>
                </div>

                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Provider identifiers</p>
                  {identities.length ? (
                    <div className="mt-3 divide-y divide-[var(--omnix-border)]">
                      {identities.map((identity, index) => (
                        <div key={identityKey(identity, index)} className="grid gap-2 py-3 text-sm text-slate-200 sm:grid-cols-[10rem_minmax(0,1fr)]">
                          <span className="font-semibold text-white">{providerLabel(identity.provider)}</span>
                          <span className="break-all font-mono text-xs text-[var(--omnix-text-2)]">{identity.identity_id || identity.id || identity.user_id || "Identifier unavailable"}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="mt-2 text-sm text-[var(--omnix-text-2)]">No provider identifier details are available for this session.</p>
                  )}
                </div>

                <div className="grid gap-5 lg:grid-cols-2">
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Auth metadata</p>
                    <pre className="omnix-scrollbar mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--omnix-border)] bg-black/20 p-4 text-xs leading-5 text-slate-300">{safeJson(appMetadata)}</pre>
                  </div>
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--omnix-text-3)]">Profile metadata</p>
                    <pre className="omnix-scrollbar mt-3 max-h-72 overflow-auto rounded-xl border border-[var(--omnix-border)] bg-black/20 p-4 text-xs leading-5 text-slate-300">{safeJson(userMetadata)}</pre>
                  </div>
                </div>
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </SettingsShell>
  );
}
