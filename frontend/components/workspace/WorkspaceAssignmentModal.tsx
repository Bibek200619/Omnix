"use client";

import { useEffect, useState, useMemo, useCallback } from "react";
import {
  Search,
  UserPlus,
  X,
  Loader2,
  Check,
  Shield,
  UserRound,
  Users,
} from "lucide-react";
import { apiClient } from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { Modal } from "@/components/ui/Modal";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { logClientError } from "@/lib/errors";
import {
  isWorkspaceFounderRole,
} from "@/lib/workspace-roles";
import { cn } from "@/lib/utils";
import type {
  WorkspacePotentialMember,
  WorkspaceRole,
  WorkspaceMember,
} from "@/lib/workspace-types";

type WorkspaceAssignmentModalProps = {
  open: boolean;
  workspaceId: string;
  workspaceName: string;
  onClose: () => void;
  onAssign: (userId: string, role: WorkspaceRole) => Promise<WorkspaceMember>;
  currentUserRole: WorkspaceRole;
};

export function WorkspaceAssignmentModal({
  open,
  workspaceId,
  workspaceName,
  onClose,
  onAssign,
  currentUserRole,
}: WorkspaceAssignmentModalProps) {
  const [potentialMembers, setPotentialMembers] = useState<WorkspacePotentialMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null);
  const [selectedRole, setSelectedRole] = useState<WorkspaceRole>("sub_member");
  const [assigningId, setAssigningId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchPotentialMembers = useCallback(async () => {
    try {
      setLoading(true);
      const data = await apiClient.get<WorkspacePotentialMember[]>(
        `/workspaces/${workspaceId}/potential-members`
      );
      setPotentialMembers(data || []);
    } catch (err) {
      logClientError("Failed to fetch potential members", err, { endpoint: `/workspaces/${workspaceId}/potential-members` });
      setError("Unable to load organizational members.");
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (open) {
      void fetchPotentialMembers();
      setSearchQuery("");
      setSelectedUserId(null);
      setSelectedRole("sub_member");
      setError(null);
    }
  }, [open, fetchPotentialMembers]);

  const filteredMembers = useMemo(() => {
    const query = searchQuery.toLowerCase().trim();
    if (!query) return potentialMembers;
    return potentialMembers.filter(
      (m) =>
        (m.email || "").toLowerCase().includes(query) ||
        (m.full_name || "").toLowerCase().includes(query) ||
        (m.handle || "").toLowerCase().includes(query)
    );
  }, [potentialMembers, searchQuery]);

  async function handleAssign() {
    if (!selectedUserId) return;
    try {
      setAssigningId(selectedUserId);
      setError(null);
      await onAssign(selectedUserId, selectedRole);
      // Success - remove from list and reset
      setPotentialMembers((prev) => prev.filter((m) => m.user_id !== selectedUserId));
      setSelectedUserId(null);
    } catch (err) {
      logClientError("Failed to assign workspace member", err, { endpoint: `/workspaces/${workspaceId}/members` });
      setError("Assignment failed.");
    } finally {
      setAssigningId(null);
    }
  }

  const canAssignLeader = isWorkspaceFounderRole(currentUserRole);

  return (
    <Modal
      isOpen={open}
      onClose={onClose}
      title="Add Collaborator"
      className="max-w-xl rounded-3xl border-[var(--omnix-border-2)] bg-[#0a0d14]/90 shadow-[0_32px_128px_rgba(0,0,0,0.6)] ring-1 ring-white/10"
      footerClassName="gap-3 px-4 py-4 sm:justify-end sm:px-6"
      footer={(
        <>
          <Button variant="ghost" className="flex-1 sm:flex-none" onClick={onClose} disabled={Boolean(assigningId)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={handleAssign}
            disabled={!selectedUserId}
            isLoading={Boolean(assigningId)}
            className="flex-1 rounded-xl px-4 sm:flex-none sm:px-6"
          >
            Add to workspace
          </Button>
        </>
      )}
    >
      <div className="pointer-events-none absolute left-1/2 top-0 h-48 w-full -translate-x-1/2 bg-[var(--omnix-cyan)] opacity-5 blur-[80px]" />

      <Modal.Header className="items-center justify-between px-4 py-4 sm:px-6 sm:py-5">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--omnix-grad-primary)] text-white shadow-[var(--omnix-glow-sm)]">
                <UserPlus className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="omnix-display truncate text-lg font-semibold text-white">Add Collaborator</h2>
                <p className="truncate text-xs text-[var(--omnix-text-2)]">Add members to {workspaceName}</p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close assignment modal"
              title="Close assignment modal"
              className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-slate-400 transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
      </Modal.Header>

      <Modal.Body className="p-4 sm:p-6">
            <div className="relative mb-6">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
              <input
                type="text"
                placeholder="Search organizational members..."
                className="w-full rounded-xl border border-[var(--omnix-border)] bg-[var(--omnix-surface)] py-2.5 pl-10 pr-4 text-sm text-white placeholder:text-slate-600 focus:border-[var(--omnix-cyan)] focus:outline-none focus:ring-1 focus:ring-[var(--omnix-cyan)/30]"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="h-[280px] min-h-[200px] overflow-y-auto pr-1 sm:h-[320px]">
              {loading ? (
                <div className="flex h-full flex-col items-center justify-center gap-3 text-[var(--omnix-text-2)]">
                  <Loader2 className="h-6 w-6 animate-spin text-[var(--omnix-cyan)]" />
                  <span className="text-sm font-medium">Scanning organization...</span>
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.03] text-slate-600">
                    <Users className="h-8 w-8" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-white">No collaborators found</h3>
                    <p className="mt-1 text-xs text-slate-500">All available members are already added.</p>
                  </div>
                </div>
              ) : (
                <div className="space-y-1.5 pb-2">
                  {filteredMembers.map((member) => (
                    <button
                      key={member.user_id}
                      onClick={() => setSelectedUserId(member.user_id)}
                      className={cn(
                        "group flex w-full items-center justify-between rounded-xl border px-3.5 py-3 transition",
                        selectedUserId === member.user_id
                          ? "border-[var(--omnix-cyan)] bg-[var(--omnix-cyan)]/10 shadow-[var(--omnix-glow-xs)]"
                          : "border-transparent hover:bg-white/[0.04] hover:border-white/10"
                      )}
                    >
                      <div className="flex items-center gap-3">
                        <ProfileAvatar
                          name={member.full_name || member.email || member.handle || member.user_id}
                          email={member.email}
                          avatarUrl={member.avatar_url}
                          className="h-10 w-10 text-xs"
                        />
                        <div className="text-left">
                          <div className="text-sm font-semibold text-white">
                            {member.full_name || member.email?.split("@")[0] || member.handle || member.user_id}
                          </div>
                          <div className="text-[11px] text-slate-500">{member.email || member.handle || member.user_id}</div>
                        </div>
                      </div>
                      {selectedUserId === member.user_id && (
                        <div className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--omnix-cyan)] text-slate-900">
                          <Check className="h-3 w-3" strokeWidth={3} />
                        </div>
                      )}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {selectedUserId && (
              <div className="mt-6 animate-in fade-in slide-in-from-top-2 duration-300">
                <label className="mb-3 block text-xs font-semibold uppercase tracking-wider text-[var(--omnix-text-3)]">
                  Workspace Scope
                </label>
                <div className={cn("grid gap-3", canAssignLeader ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1")}>
                  <button
                    onClick={() => setSelectedRole("sub_member")}
                    className={cn(
                      "flex flex-col gap-2 rounded-xl border p-4 text-left transition",
                      selectedRole === "sub_member"
                        ? "border-[var(--omnix-cyan)] bg-[var(--omnix-cyan)]/5"
                        : "border-[var(--omnix-border)] bg-[var(--omnix-surface)] hover:border-white/20"
                    )}
                  >
                    <div className="flex items-center gap-2">
                      <UserRound className={cn("h-4 w-4", selectedRole === "sub_member" ? "text-[var(--omnix-cyan)]" : "text-slate-400")} />
                      <span className="text-sm font-semibold text-white">Workspace Member</span>
                    </div>
                    <p className="text-[11px] leading-relaxed text-slate-500">
                      Standard collaborative access within this workspace scope.
                    </p>
                  </button>

                  {canAssignLeader && (
                    <button
                      onClick={() => setSelectedRole("team_lead")}
                      className={cn(
                        "flex flex-col gap-2 rounded-xl border p-4 text-left transition",
                        selectedRole === "team_lead"
                          ? "border-indigo-400/50 bg-indigo-400/5"
                          : "border-[var(--omnix-border)] bg-[var(--omnix-surface)] hover:border-white/20"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Shield className={cn("h-4 w-4", selectedRole === "team_lead" ? "text-indigo-300" : "text-slate-400")} />
                        <span className="text-sm font-semibold text-white">Team Lead</span>
                      </div>
                      <p className="text-[11px] leading-relaxed text-slate-500">
                        Authority to manage members and operational collaboration.
                      </p>
                    </button>
                  )}
                </div>
              </div>
            )}

            {error && (
              <div className="mt-4 rounded-lg bg-rose-500/10 px-4 py-2.5 text-xs font-medium text-rose-300 ring-1 ring-inset ring-rose-500/20">
                {error}
              </div>
            )}
      </Modal.Body>
    </Modal>
  );
}
