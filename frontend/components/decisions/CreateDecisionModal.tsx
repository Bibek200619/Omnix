"use client";

import { useState, useEffect, useCallback, useId } from "react";
import { X, BadgeCheck, Loader2, Target, ListTodo, Search, Link2, Unlink2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import { MentionTextarea, mentionPayload } from "@/components/mentions/MentionTextarea";
import { apiClient } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace-context";
import { cn } from "@/lib/utils";
import type { 
  WorkspaceDecision, 
  WorkspaceDecisionStatus, 
  WorkspaceInitiative, 
  WorkspaceMentionMetadata,
  WorkspaceTask 
} from "@/lib/workspace-types";

interface CreateDecisionModalProps {
  workspaceId: string;
  onClose: () => void;
  onSuccess: (decision: WorkspaceDecision) => void;
  initialValues?: {
    title?: string;
    reason?: string;
    description?: string;
    status?: WorkspaceDecisionStatus;
  };
}

const statusOptions: { value: WorkspaceDecisionStatus; label: string }[] = [
  { value: "proposed", label: "Proposed" },
  { value: "accepted", label: "Accepted" },
];

export function CreateDecisionModal({ workspaceId, onClose, onSuccess, initialValues }: CreateDecisionModalProps) {
  const formId = useId();
  const { activeMembers } = useWorkspace();
  const [title, setTitle] = useState(initialValues?.title ?? "");
  const [reason, setReason] = useState(initialValues?.reason ?? "");
  const [description, setDescription] = useState(initialValues?.description ?? "");
  const [mentions, setMentions] = useState<WorkspaceMentionMetadata[]>([]);
  const [status, setStatus] = useState<WorkspaceDecisionStatus>(initialValues?.status ?? "accepted");
  const [creating, setCreating] = useState(false);

  // Linkages
  const [selectedInitiativeId, setSelectedInitiativeId] = useState<string | null>(null);
  const [selectedTaskIds, setSelectedTaskIds] = useState<Set<string>>(new Set());

  // Search/Selectors
  const [initiatives, setInitiatives] = useState<WorkspaceInitiative[]>([]);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [loadingResources, setLoadingResources] = useState(false);
  const [showInitiativeSelector, setShowInitiativeSelector] = useState(false);
  const [showTaskSelector, setShowTaskSelector] = useState(false);
  const [initiativeSearch, setInitiativeSearch] = useState("");
  const [taskSearch, setTaskSearch] = useState("");

  const loadResources = useCallback(async () => {
    setLoadingResources(true);
    try {
      const [initData, taskData] = await Promise.all([
        apiClient.get<WorkspaceInitiative[]>(`/workspaces/${workspaceId}/initiatives`),
        apiClient.get<WorkspaceTask[]>(`/workspaces/${workspaceId}/tasks`),
      ]);
      setInitiatives(initData);
      setTasks(taskData);
    } catch (err) {
      console.error("Failed to load resources", err);
    } finally {
      setLoadingResources(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    void loadResources();
  }, [loadResources]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !reason.trim() || creating) return;

    setCreating(true);
    try {
      // 1. Create decision
      const decision = await apiClient.post<WorkspaceDecision>(
        `/workspaces/${workspaceId}/decisions`,
        {
          title: title.trim(),
          decision_reason: reason.trim(),
          description: description.trim() || null,
          status,
          mentions: mentionPayload(mentions, `${reason}\n${description}`),
        }
      );

      // 2. Link initiative if selected
      if (selectedInitiativeId) {
        await apiClient.patch(
          `/workspaces/${workspaceId}/decisions/${decision.id}/initiative`,
          { initiative_id: selectedInitiativeId }
        );
      }

      // 3. Link tasks if selected
      if (selectedTaskIds.size > 0) {
        await Promise.all(
          Array.from(selectedTaskIds).map((taskId) =>
            apiClient.post(`/workspaces/${workspaceId}/decisions/${decision.id}/tasks`, {
              task_id: taskId,
            })
          )
        );
      }

      // Re-fetch the decision to get updated linkages if necessary, 
      // but usually the success callback will trigger a refresh or we can just pass the created one.
      // Given the complex linkage, let's fetch it once more to be sure it's fully hydrated.
      const fullyHydrated = await apiClient.get<WorkspaceDecision>(
        `/workspaces/${workspaceId}/decisions/${decision.id}`
      );

      onSuccess(fullyHydrated);
    } catch (err) {
      console.error("Failed to create decision", err);
    } finally {
      setCreating(false);
    }
  };

  const toggleTask = (taskId: string) => {
    const next = new Set(selectedTaskIds);
    if (next.has(taskId)) next.delete(taskId);
    else next.add(taskId);
    setSelectedTaskIds(next);
  };

  const filteredInitiatives = initiatives.filter(i => 
    i.title.toLowerCase().includes(initiativeSearch.toLowerCase())
  );

  const filteredTasks = tasks.filter(t => 
    t.title.toLowerCase().includes(taskSearch.toLowerCase())
  );

  return (
    <Modal
      isOpen
      onClose={onClose}
      title="Record New Decision"
      backdropClassName="z-[100] px-4 py-6"
      className="omnix-mobile-sheet omnix-panel-strong max-h-[calc(100dvh_-_2rem)] max-w-xl rounded-2xl border-cyan-400/20 shadow-2xl"
      footerClassName="border-white/5 bg-black/20 p-4 sm:px-6 sm:py-4"
      footer={(
        <>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={onClose}
            className="text-[var(--omnix-text-3)] hover:text-white"
          >
            Cancel
          </Button>
          <Button
            type="submit"
            form={formId}
            size="sm"
            isLoading={creating}
            disabled={!title.trim() || !reason.trim()}
            leftIcon={<BadgeCheck className="h-3.5 w-3.5" />}
            className="min-w-[140px] shadow-[0_0_20px_rgba(34,211,238,0.15)]"
          >
            Record Decision
          </Button>
        </>
      )}
    >
      <form id={formId} onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col">
          {/* Header */}
          <Modal.Header className="border-white/5 p-4 sm:p-6">
            <div>
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-400/70">Decision Memory</p>
              <h2 className="mt-1 text-xl font-bold text-white">Record New Decision</h2>
              <p className="mt-1 text-xs text-[var(--omnix-text-3)]">Capture important organizational choices and their rationale.</p>
            </div>
            <button 
              type="button" 
              onClick={onClose} 
              aria-label="Close decision modal"
              title="Close decision modal"
              className="rounded-lg p-2 text-white/40 transition hover:bg-white/5 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
          </Modal.Header>

          {/* Scrollable Content */}
          <Modal.Body className="p-4 sm:p-6">
            <div className="space-y-6">
              {/* Basic Info */}
              <div className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-[1fr_12rem]">
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)]">Title *</label>
                    <Input 
                      value={title} 
                      onChange={(e) => setTitle(e.target.value)} 
                      placeholder="e.g., Use Supabase Realtime for Collaboration"
                      className="h-11 bg-white/5 border-white/10 focus:border-cyan-400/40"
                      autoFocus
                      required
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)]">Status</label>
                    <select
                      value={status}
                      onChange={(e) => setStatus(e.target.value as WorkspaceDecisionStatus)}
                      className="omnix-input h-11 w-full rounded-lg bg-white/5 border-white/10 px-3 text-sm focus:border-cyan-400/40 outline-none"
                    >
                      {statusOptions.map(opt => (
                        <option key={opt.value} value={opt.value} className="bg-neutral-900 text-white">{opt.label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)]">Reason *</label>
                  <MentionTextarea
                    value={reason}
                    onChange={setReason}
                    members={activeMembers}
                    mentions={mentions}
                    onMentionsChange={setMentions}
                    required
                    className="omnix-input min-h-[100px] w-full resize-none rounded-lg bg-white/5 border-white/10 p-3 text-sm leading-6 focus:border-cyan-400/40 outline-none transition-colors"
                    placeholder="Why was this choice made? (Required)"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)]">Description</label>
                  <MentionTextarea
                    value={description}
                    onChange={setDescription}
                    members={activeMembers}
                    mentions={mentions}
                    onMentionsChange={setMentions}
                    className="omnix-input min-h-[80px] w-full resize-none rounded-lg bg-white/5 border-white/10 p-3 text-sm leading-6 focus:border-cyan-400/40 outline-none transition-colors"
                    placeholder="Additional context or impact analysis..."
                  />
                </div>
              </div>

              {/* Linkages Section */}
              <div className="border-t border-white/5 pt-6">
                <h3 className="mb-4 text-[10px] font-bold uppercase tracking-[0.18em] text-white/40">Linkages & Context</h3>
                
                <div className="grid gap-6 sm:grid-cols-2">
                  {/* Initiative Linker */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <Target className="h-3.5 w-3.5 text-cyan-400" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white">Linked Initiative</span>
                      </div>
                      {selectedInitiativeId && (
                        <button 
                          type="button" 
                          onClick={() => setSelectedInitiativeId(null)}
                          className="text-[9px] font-bold uppercase text-rose-400 hover:text-rose-300"
                        >
                          Clear
                        </button>
                      )}
                    </div>

                    {!showInitiativeSelector ? (
                      <button
                        type="button"
                        onClick={() => setShowInitiativeSelector(true)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border border-dashed p-3 text-left transition-all",
                          selectedInitiativeId 
                            ? "border-cyan-400/30 bg-cyan-400/5 text-white" 
                            : "border-white/10 bg-white/[0.02] text-[var(--omnix-text-3)] hover:border-white/20 hover:bg-white/[0.04]"
                        )}
                      >
                        <span className="truncate text-xs font-medium">
                          {selectedInitiativeId 
                            ? initiatives.find(i => i.id === selectedInitiativeId)?.title || "Selected Initiative"
                            : "Link strategic initiative..."}
                        </span>
                        <Search className="h-3.5 w-3.5 opacity-40" />
                      </button>
                    ) : (
                      <div className="rounded-xl border border-cyan-400/20 bg-black/40 p-2 shadow-xl">
                        <div className="relative mb-2">
                          <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-cyan-400/40" />
                          <input
                            type="text"
                            placeholder="Search..."
                            value={initiativeSearch}
                            onChange={(e) => setInitiativeSearch(e.target.value)}
                            className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-[11px] text-white focus:outline-none focus:border-cyan-400/40"
                            autoFocus
                          />
                        </div>
                        <div className="omnix-scrollbar max-h-40 overflow-y-auto space-y-0.5">
                          {loadingResources ? <Loader2 className="mx-auto my-4 h-4 w-4 animate-spin text-cyan-400/40" /> : null}
                          {filteredInitiatives.length === 0 && !loadingResources ? (
                            <p className="py-4 text-center text-[10px] text-white/20 italic">No initiatives found</p>
                          ) : (
                            filteredInitiatives.map(i => (
                              <button
                                key={i.id}
                                type="button"
                                onClick={() => {
                                  setSelectedInitiativeId(i.id);
                                  setShowInitiativeSelector(false);
                                }}
                                className={cn(
                                  "w-full rounded-md px-2 py-1.5 text-left text-[11px] transition",
                                  selectedInitiativeId === i.id ? "bg-cyan-400/10 text-cyan-400" : "text-white/60 hover:bg-white/5 hover:text-white"
                                )}
                              >
                                {i.title}
                              </button>
                            ))
                          )}
                        </div>
                        <button 
                          type="button" 
                          onClick={() => setShowInitiativeSelector(false)}
                          className="mt-2 w-full py-1 text-[9px] font-bold uppercase text-white/20 hover:text-white/40"
                        >
                          Cancel
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Task Linker */}
                  <div className="space-y-3">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <ListTodo className="h-3.5 w-3.5 text-white/40" />
                        <span className="text-[10px] font-bold uppercase tracking-wider text-white">Linked Tasks</span>
                      </div>
                      <span className="text-[10px] font-mono text-cyan-400">{selectedTaskIds.size} selected</span>
                    </div>

                    {!showTaskSelector ? (
                      <button
                        type="button"
                        onClick={() => setShowTaskSelector(true)}
                        className={cn(
                          "flex w-full items-center justify-between rounded-xl border border-dashed p-3 text-left transition-all",
                          selectedTaskIds.size > 0
                            ? "border-white/20 bg-white/5 text-white" 
                            : "border-white/10 bg-white/[0.02] text-[var(--omnix-text-3)] hover:border-white/20 hover:bg-white/[0.04]"
                        )}
                      >
                        <span className="truncate text-xs font-medium">
                          {selectedTaskIds.size > 0
                            ? `${selectedTaskIds.size} execution tasks linked`
                            : "Link execution tasks..."}
                        </span>
                        <Search className="h-3.5 w-3.5 opacity-40" />
                      </button>
                    ) : (
                      <div className="rounded-xl border border-white/10 bg-black/40 p-2 shadow-xl">
                        <div className="relative mb-2">
                          <Search className="absolute left-2.5 top-2.5 h-3 w-3 text-white/20" />
                          <input
                            type="text"
                            placeholder="Search..."
                            value={taskSearch}
                            onChange={(e) => setTaskSearch(e.target.value)}
                            className="w-full rounded-md border border-white/10 bg-white/5 py-1.5 pl-8 pr-3 text-[11px] text-white focus:outline-none focus:border-white/20"
                            autoFocus
                          />
                        </div>
                        <div className="omnix-scrollbar max-h-40 overflow-y-auto space-y-0.5">
                          {loadingResources ? <Loader2 className="mx-auto my-4 h-4 w-4 animate-spin text-white/20" /> : null}
                          {filteredTasks.length === 0 && !loadingResources ? (
                            <p className="py-4 text-center text-[10px] text-white/20 italic">No tasks found</p>
                          ) : (
                            filteredTasks.map(t => {
                              const isSelected = selectedTaskIds.has(t.id);
                              return (
                                <button
                                  key={t.id}
                                  type="button"
                                  onClick={() => toggleTask(t.id)}
                                  className={cn(
                                    "flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-[11px] transition",
                                    isSelected ? "bg-cyan-400/10 text-cyan-400" : "text-white/60 hover:bg-white/5 hover:text-white"
                                  )}
                                >
                                  <span className="truncate">{t.title}</span>
                                  {isSelected ? <Unlink2 className="h-3 w-3 opacity-50" /> : <Link2 className="h-3 w-3 opacity-30" />}
                                </button>
                              );
                            })
                          )}
                        </div>
                        <button 
                          type="button" 
                          onClick={() => setShowTaskSelector(false)}
                          className="mt-2 w-full py-1 text-[9px] font-bold uppercase text-white/20 hover:text-white/40"
                        >
                          Done
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </Modal.Body>
        </form>
    </Modal>
  );
}
