"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, X } from "lucide-react";
import { OmnixMark } from "@/components/brand/OmnixMark";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { Button } from "@/components/ui/Button";
import { Tooltip } from "@/components/ui/Tooltip";
import { PendingWorkspaceInvites } from "@/components/workspace/PendingWorkspaceInvites";
import { useAuth } from "@/lib/auth-context";
import { useProfile } from "@/lib/profile-context";
import { cn } from "@/lib/utils";
import { SidebarNav } from "./sidebar/SidebarNav";
import { WorkspaceHierarchyMini } from "./sidebar/SidebarPresence";
import { WorkspaceSelector } from "./sidebar/WorkspaceSelector";

type SidebarProps = {
  isOpen: boolean;
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapse: () => void;
};

function profileDisplayName(userEmail?: string | null, metadata?: Record<string, unknown>, profileName?: string | null) {
  if (profileName?.trim()) return profileName.trim();
  const fullName = metadata?.full_name;
  const name = metadata?.name;
  if (typeof fullName === "string" && fullName.trim()) return fullName.trim();
  if (typeof name === "string" && name.trim()) return name.trim();
  return userEmail || "Omnix user";
}

export function Sidebar({ isOpen, collapsed, onClose, onToggleCollapse }: SidebarProps) {
  const pathname = usePathname();
  const { user } = useAuth();
  const { profile } = useProfile();
  const displayName = profileDisplayName(user?.email, user?.user_metadata, profile?.display_name);
  const displayEmail = profile?.email || user?.email || "";
  const displayHandle = profile?.username || profile?.handle || null;

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden",
          isOpen ? "opacity-100" : "pointer-events-none opacity-0",
        )}
        onClick={onClose}
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[min(21rem,calc(100vw_-_2.75rem))] flex-col overflow-hidden border-r border-[var(--omnix-border)] bg-[linear-gradient(180deg,rgba(5,12,23,0.98),rgba(4,10,20,0.985))] shadow-[24px_0_120px_rgba(0,0,0,0.6),4px_0_40px_rgba(0,255,255,0.05)] backdrop-blur-[28px] transition-transform duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)] lg:w-[var(--omnix-sidebar-w)]",
          isOpen ? "translate-x-0" : "-translate-x-full",
          collapsed ? "lg:-translate-x-full" : "lg:translate-x-0",
        )}
      >
        <div className="pointer-events-none absolute inset-x-0 top-0 h-[260px] bg-[radial-gradient(ellipse_at_50%_-10%,rgba(0,255,255,0.11)_0%,transparent_70%)]" />
        <div className="pointer-events-none absolute inset-0 opacity-[0.025] [animation:auth-grid_22s_linear_infinite] [background-image:linear-gradient(rgba(0,255,255,0.55)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,255,0.55)_1px,transparent_1px)] [background-size:64px_64px]" />
        <div className="pointer-events-none absolute inset-y-0 right-0 w-px bg-[linear-gradient(180deg,transparent,rgba(0,255,255,0.15),rgba(0,255,255,0.08),transparent)]" />

        <div className="relative flex h-auto items-start justify-between border-b border-[var(--omnix-border)] px-[18px] pb-3.5 pt-[18px]">
          <div className="flex w-full flex-col gap-3">
            <div className="flex items-center justify-between">
              <Link href="/dashboard" onClick={onClose} className="group/logo flex items-center gap-2.5">
                <div className="omnix-logo-glow">
                  <OmnixMark size={34} />
                </div>
                <div>
                  <span className="omnix-display block text-lg font-semibold leading-tight tracking-[-0.045em] text-white">Omnix</span>
                  <span className="text-[10px] leading-tight tracking-[0.05em] text-[var(--omnix-cyan)] opacity-60">AI Workspace</span>
                </div>
              </Link>
              <div className="flex items-center gap-1">
                <Tooltip content="Collapse workspace sidebar" className="hidden lg:inline-flex">
                  <Button
                    type="button"
                    variant="ghost"
                    size={"icon"}
                    className="h-[26px] w-[26px] rounded-[7px] border border-[var(--omnix-border)] bg-transparent text-[var(--omnix-text-3)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:text-white"
                    aria-label="Collapse workspace sidebar"
                    title="Collapse workspace sidebar"
                    onClick={onToggleCollapse}
                  >
                    <PanelLeftClose className="h-4 w-4" />
                  </Button>
                </Tooltip>
                <Tooltip content="Close navigation" className="lg:hidden">
                  <Button
                    type="button"
                    variant="ghost"
                    size={"icon"}
                    className="h-10 w-10 rounded-[10px] border border-[var(--omnix-border)] bg-transparent text-[var(--omnix-text-3)] hover:border-[var(--omnix-border-active)] hover:bg-[var(--omnix-surface)] hover:text-white"
                    aria-label="Close navigation"
                    title="Close navigation"
                    onClick={onClose}
                  >
                    <X className="h-4 w-4" />
                  </Button>
                </Tooltip>
              </div>
            </div>
            <div className="space-y-2 pt-1">
              <div className="flex items-center justify-between px-1">
                <p className="text-[10px] font-semibold uppercase tracking-[0.1em] text-[var(--omnix-text-3)]">Workspace</p>
              </div>
              <WorkspaceSelector onWorkspaceSelect={onClose} />
            </div>
            <PendingWorkspaceInvites compact maxVisible={2} />
          </div>
        </div>

        <div className="hidden">
          <WorkspaceHierarchyMini onClose={onClose} />
        </div>

        <SidebarNav pathname={pathname} onNavigate={onClose} />

        <div className="relative border-t border-[rgba(0,255,255,0.07)] p-2.5 pb-[calc(env(safe-area-inset-bottom)_+_0.625rem)]">
          <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,rgba(0,255,255,0.2),transparent)]" />
          <Link
            href="/settings/profile"
            onClick={onClose}
            className="group/profile flex items-center gap-2.5 rounded-[var(--omnix-radius-sm)] border border-[var(--omnix-border)] bg-[rgba(0,255,255,0.03)] px-2.5 py-2.5 transition duration-200 hover:border-[rgba(0,255,255,0.2)] hover:bg-[rgba(0,255,255,0.06)] hover:shadow-[var(--omnix-glow-xs)]"
          >
            <div className="relative shrink-0">
              <ProfileAvatar
                name={displayName}
                email={displayEmail}
                handle={displayHandle}
                avatarUrl={profile?.avatar_url}
                className="h-8 w-8 border-cyan-300/35 bg-cyan-300/12 text-xs text-cyan-50 shadow-[0_0_12px_rgba(0,255,255,0.25)]"
              />
              <span className="omnix-online-dot absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 border-[2px] border-[rgba(5,12,23,0.98)]" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold text-white">{displayName}</div>
              <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-[var(--omnix-text-3)]">
                <span className="font-medium text-[var(--omnix-green)]">{displayHandle ? `@${displayHandle}` : "Online"}</span>
              </div>
            </div>
            <span className="text-[var(--omnix-text-3)] opacity-40 transition group-hover/profile:opacity-70">›</span>
          </Link>
        </div>
      </aside>
    </>
  );
}
