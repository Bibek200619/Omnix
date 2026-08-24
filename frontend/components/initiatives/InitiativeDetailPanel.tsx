import type { FormEvent } from "react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  ClipboardCheck,
  Link2,
  Loader2,
  MessagesSquare,
  Sparkles,
  Target,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { DecisionTraceabilityList } from "@/components/decisions/DecisionTraceabilityList";
import { RecordTraceabilityPanel } from "@/components/provenance/RecordTraceabilityPanel";
import { cn } from "@/lib/utils";
import type {
  WorkspaceChannel,
  WorkspaceInitiative,
  WorkspaceInitiativeAssistance,
  WorkspaceInitiativeAssistanceMode,
  WorkspaceInitiativeResource,
  WorkspaceInitiativeStatus,
  WorkspaceMember,
  WorkspaceTask,
} from "@/lib/workspace-types";
import { initiativeAssistanceLabels, initiativeStatuses } from "./initiativeOptions";

type SimplifiedMomentum = {
  label: string;
  color: string;
  description: string;
};

type InitiativeDetailPanelProps = {
  selected: WorkspaceInitiative | null;
  selectedId: string | null;
  mobileTab: "brief" | "plan" | "assist";
  updating: boolean;
  members: WorkspaceMember[];
  availableTasks: WorkspaceTask[];
  availableChannels: WorkspaceChannel[];
  taskToAttach: string;
  channelToAttach: string;
  resourceType: WorkspaceInitiativeResource["resource_type"];
  resourceLabel: string;
  resourceId: string;
  simplifiedMomentum: SimplifiedMomentum | null;
  progressPercentage: number;
  assistance: WorkspaceInitiativeAssistance | null;
  assisting: WorkspaceInitiativeAssistanceMode | null;
  onBack: () => void;
  onMobileTabChange: (tab: "brief" | "plan" | "assist") => void;
  onPatchInitiative: (payload: Partial<WorkspaceInitiative>) => void;
  onTaskToAttachChange: (value: string) => void;
  onAttachTask: () => void;
  onDetachTask: (task: WorkspaceTask) => void;
  onChannelToAttachChange: (value: string) => void;
  onAttachChannel: () => void;
  onDetachChannel: (channelId: string) => void;
  onResourceTypeChange: (value: WorkspaceInitiativeResource["resource_type"]) => void;
  onResourceLabelChange: (value: string) => void;
  onResourceIdChange: (value: string) => void;
  onAddResource: (event: FormEvent<HTMLFormElement>) => void;
  onRequestAssistance: (mode: WorkspaceInitiativeAssistanceMode) => void;
};

function readableOrigin(value: unknown) {
  const origin = String(value || "manual").replace(/[_-]/g, " ").trim();
  if (!origin) return "Manual";
  return origin.charAt(0).toUpperCase() + origin.slice(1);
}

function resourceHref(resource: WorkspaceInitiativeResource) {
  if (resource.resource_type === "file") return `/files?id=${resource.resource_id}`;
  if (resource.resource_type === "decision") return `/decisions?id=${resource.resource_id}`;
  return undefined;
}

export function InitiativeDetailPanel({
  selected,
  selectedId,
  mobileTab,
  updating,
  members,
  availableTasks,
  availableChannels,
  taskToAttach,
  channelToAttach,
  resourceType,
  resourceLabel,
  resourceId,
  simplifiedMomentum,
  progressPercentage,
  assistance,
  assisting,
  onBack,
  onMobileTabChange,
  onPatchInitiative,
  onTaskToAttachChange,
  onAttachTask,
  onDetachTask,
  onChannelToAttachChange,
  onAttachChannel,
  onDetachChannel,
  onResourceTypeChange,
  onResourceLabelChange,
  onResourceIdChange,
  onAddResource,
  onRequestAssistance,
}: InitiativeDetailPanelProps) {
  const traceabilityOrigin = selected
    ? {
        kind: "origin" as const,
        label: `${readableOrigin(selected.provenance_summary?.origin ?? selected.activity_metadata?.origin)} initiative`,
        detail:
          selected.provenance_summary?.summary ??
          (selected.creator_name ? `Recorded by ${selected.creator_name}` : selected.created_at ? `Recorded ${new Date(selected.created_at).toLocaleDateString()}` : null),
      }
    : null;
  const traceabilityEvidence = selected?.initiative_context
    ? [{
        kind: "evidence" as const,
        label: "Mission context",
        detail: selected.initiative_context,
      }]
    : [];
  const traceabilityTasks = selected?.linked_tasks.map((task) => ({
    kind: "task" as const,
    label: task.title,
    href: `/tasks?id=${task.id}`,
    detail: task.status,
  })) ?? [];
  const traceabilityDecisions = selected?.linked_decisions.map((decision) => ({
    kind: "decision" as const,
    label: decision.title,
    href: `/decisions?id=${decision.id}`,
    detail: decision.decision_reason || decision.status,
  })) ?? [];
  const traceabilitySources = selected
    ? [
        ...selected.linked_channels.map((channel) => ({
          kind: "conversation" as const,
          label: channel.name,
          href: `/conversations?channel=${channel.id}`,
          detail: `${channel.message_count} messages recorded`,
        })),
        ...selected.linked_resources.map((resource) => ({
          kind: resource.resource_type === "file" ? "file" as const : "source" as const,
          label: resource.label || resource.resource_id,
          href: resourceHref(resource),
          detail: resource.resource_type.replace("_", " "),
        })),
        ...(selected.provenance_summary?.needs_repair
          ? [{
              kind: "source" as const,
              label: "Missing source context",
              detail: selected.provenance_summary.summary,
            }]
          : []),
      ]
    : [];

  return (
    <main
      className={cn(
        "omnix-panel order-3 min-w-0 rounded-xl p-4 sm:p-6 lg:order-none xl:min-h-[30rem] xl:overflow-y-auto",
        !selectedId && "hidden xl:block",
      )}
    >
      {!selected ? (
        <div className="flex h-full min-h-[24rem] items-center justify-center text-sm text-[var(--omnix-text-2)]">
          Select or open an initiative.
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-4 lg:hidden">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={onBack}
                className="flex h-11 items-center gap-1.5 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 text-[10px] font-bold uppercase tracking-wider text-cyan-200"
              >
                ‹ Back
              </button>
              <h2 className="omnix-display truncate text-lg font-bold text-white">{selected.title}</h2>
            </div>
            <div className="flex gap-1 rounded-lg border border-[var(--omnix-border)] bg-black/20 p-1">
              {(["brief", "plan", "assist"] as const).map((tab) => (
                <button
                  key={tab}
                  type="button"
                  onClick={() => onMobileTabChange(tab)}
                  className={cn(
                    "min-h-11 flex-1 rounded-md px-2 text-[10px] font-bold uppercase tracking-wider transition-all",
                    mobileTab === tab
                      ? "bg-cyan-400/10 text-cyan-400 shadow-[inset_0_1px_1px_var(--omnix-rgba-255-255-255-0-05)]"
                      : "text-[var(--omnix-text-3)]",
                  )}
                >
                  {tab}
                </button>
              ))}
            </div>
          </div>

          <div className={cn("mb-6 flex flex-wrap items-start justify-between gap-4 border-b border-[var(--omnix-border)] pb-6", mobileTab !== "brief" && "hidden lg:flex")}>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-cyan-300/60">Mission</p>
              <h2 className="omnix-display mt-2 break-words text-2xl font-bold text-white">{selected.title}</h2>
              {selected.description ? (
                <p className="mt-3 max-w-2xl break-words text-base leading-7 text-[var(--omnix-text-2)]">
                  {selected.description}
                </p>
              ) : null}
            </div>
            <div className="flex flex-col items-end gap-3">
              <select
                value={selected.status}
                disabled={updating}
                onChange={(event) => onPatchInitiative({ status: event.target.value as WorkspaceInitiativeStatus })}
                className={cn(
                  "omnix-input h-9 rounded-lg px-3 text-xs font-bold transition focus-visible:ring-2 focus-visible:ring-cyan-300/70",
                  selected.status === "focused" ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-50" : "bg-black/20",
                )}
              >
                {initiativeStatuses.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
              <div className="text-right">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--omnix-text-3)]">Completion</p>
                <p className="text-xl font-bold text-white">{progressPercentage}%</p>
              </div>
            </div>
          </div>

          <div className={cn("mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3", mobileTab !== "brief" && "hidden lg:grid")}>
            <div className="rounded-2xl border border-[var(--omnix-border)] bg-black/10 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">
                <Target className="h-3.5 w-3.5" /> Momentum
              </p>
              {simplifiedMomentum && (
                <div className="flex items-start gap-3">
                  <div className={cn("mt-1 h-2 w-2 shrink-0 rounded-full shadow-[0_0_10px_currentColor]", simplifiedMomentum.color)} />
                  <div>
                    <p className={cn("text-lg font-bold leading-none", simplifiedMomentum.color)}>{simplifiedMomentum.label}</p>
                    <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--omnix-text-2)]">{simplifiedMomentum.description}</p>
                  </div>
                </div>
              )}
            </div>

            <div className="rounded-2xl border border-[var(--omnix-border)] bg-black/10 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">
                <UserRound className="h-3.5 w-3.5" /> Mission Owner
              </p>
              <select
                value={selected.owner_user_id || ""}
                disabled={updating}
                onChange={(event) => onPatchInitiative({ owner_user_id: event.target.value || null })}
                className="w-full bg-transparent text-sm font-medium text-white outline-none"
              >
                <option value="">Unassigned</option>
                {members.map((member) => (
                  <option key={member.user_id} value={member.user_id}>
                    {member.full_name || member.email || "Teammate"}
                  </option>
                ))}
              </select>
              <p className="mt-2 text-[10px] text-[var(--omnix-text-3)]">Primary operational driver</p>
            </div>

            <div className="rounded-2xl border border-[var(--omnix-border)] bg-black/10 p-4">
              <p className="mb-3 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-widest text-[var(--omnix-text-3)]">
                <CalendarDays className="h-3.5 w-3.5" /> Target Date
              </p>
              <input
                type="date"
                value={selected.target_date || ""}
                disabled={updating}
                onChange={(event) => onPatchInitiative({ target_date: event.target.value || null })}
                className="w-full bg-transparent text-sm font-medium text-white outline-none"
              />
              {!selected.target_date && <p className="mt-1 text-sm text-[var(--omnix-text-3)]">No deadline set</p>}
            </div>
          </div>

          {selected.initiative_context ? (
            <div className={cn("mb-8 rounded-2xl border border-cyan-300/12 bg-cyan-300/[0.025] p-4", mobileTab !== "brief" && "hidden lg:block")}>
              <p className="text-[10px] font-bold uppercase tracking-widest text-cyan-300/50">Mission Context</p>
              <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-7 text-[var(--omnix-text)]">{selected.initiative_context}</p>
            </div>
          ) : null}

          {traceabilityOrigin ? (
            <div className={cn("mb-8", mobileTab !== "brief" && "hidden lg:block")}>
              <RecordTraceabilityPanel
                origin={traceabilityOrigin}
                evidence={traceabilityEvidence}
                decisions={traceabilityDecisions}
                tasks={traceabilityTasks}
                sources={traceabilitySources}
              />
            </div>
          ) : null}

          <div className={cn("mb-8", mobileTab !== "brief" && "hidden lg:block")}>
            <DecisionTraceabilityList decisions={selected.linked_decisions} title="Related Decisions" />
          </div>

          {selected.momentum.blocked_task_count > 0 && (
            <div className={cn("mb-8 rounded-2xl border border-amber-400/20 bg-amber-400/[0.04] p-4", mobileTab !== "brief" && "hidden lg:block")}>
              <div className="flex items-center gap-2 text-amber-300">
                <AlertTriangle className="h-4 w-4" />
                <p className="text-xs font-bold uppercase tracking-widest">Active Blockers</p>
              </div>
              <p className="mt-2 text-sm text-amber-100/80">
                {selected.momentum.blocked_task_count} tasks are currently preventing strategic movement.
              </p>
            </div>
          )}

          <div className={cn("space-y-4", mobileTab !== "plan" && "hidden lg:block")}>
            <details className="group/disclosure overflow-hidden rounded-2xl border border-[var(--omnix-border)] bg-black/5 transition-all" open>
              <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <ClipboardCheck className="h-4 w-4 text-[var(--omnix-text-3)]" />
                  <span className="text-sm font-medium text-white">Execution Linkage</span>
                  <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-[var(--omnix-text-3)]">{selected.linked_tasks.length} tasks</span>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--omnix-text-3)] transition-transform group-open/disclosure:rotate-90" />
              </summary>
              <div className="space-y-4 border-t border-[var(--omnix-border)] p-4">
                <div className="flex gap-2">
                  <select
                    value={taskToAttach}
                    disabled={updating}
                    onChange={(event) => onTaskToAttachChange(event.target.value)}
                    className="omnix-input h-9 min-w-0 flex-1 rounded-lg px-2 text-xs focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                  >
                    <option value="">Attach existing task...</option>
                    {availableTasks.map((task) => (
                      <option key={task.id} value={task.id}>
                        {task.title}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="secondary" disabled={!taskToAttach || updating} onClick={onAttachTask}>
                    Link Task
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {selected.linked_tasks.map((task) => (
                    <div key={task.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/20 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-white">{task.title}</p>
                        <p className="mt-1 text-[10px] font-bold uppercase tracking-tighter text-[var(--omnix-text-3)]">{task.status}</p>
                      </div>
                      <button type="button" disabled={updating} onClick={() => onDetachTask(task)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--omnix-text-3)] transition-colors hover:bg-rose-400/10 hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Detach task">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {!selected.linked_tasks.length ? <p className="col-span-full py-4 text-center text-xs text-[var(--omnix-text-3)]">No task records attached.</p> : null}
                </div>
              </div>
            </details>

            <details className="group/disclosure overflow-hidden rounded-2xl border border-[var(--omnix-border)] bg-black/5 transition-all">
              <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <MessagesSquare className="h-4 w-4 text-[var(--omnix-text-3)]" />
                  <span className="text-sm font-medium text-white">Conversations</span>
                  <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-[var(--omnix-text-3)]">{selected.linked_channels.length} channels</span>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--omnix-text-3)] transition-transform group-open/disclosure:rotate-90" />
              </summary>
              <div className="space-y-4 border-t border-[var(--omnix-border)] p-4">
                <div className="flex gap-2">
                  <select
                    value={channelToAttach}
                    disabled={updating}
                    onChange={(event) => onChannelToAttachChange(event.target.value)}
                    className="omnix-input h-9 min-w-0 flex-1 rounded-lg px-2 text-xs focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                  >
                    <option value="">Attach operational channel...</option>
                    {availableChannels.map((channel) => (
                      <option key={channel.id} value={channel.id}>
                        {channel.name}
                      </option>
                    ))}
                  </select>
                  <Button size="sm" variant="secondary" disabled={!channelToAttach || updating} onClick={onAttachChannel}>
                    Link Channel
                  </Button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {selected.linked_channels.map((channel) => (
                    <div key={channel.id} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--omnix-border)] bg-black/20 px-3 py-2.5">
                      <div className="min-w-0">
                        <p className="truncate text-xs font-medium text-white">{channel.name}</p>
                        <p className="mt-1 text-[10px] text-[var(--omnix-text-3)]">{channel.message_count} messages recorded</p>
                      </div>
                      <button type="button" disabled={updating} onClick={() => onDetachChannel(channel.id)} className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--omnix-text-3)] transition-colors hover:bg-rose-400/10 hover:text-rose-400 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/70 disabled:cursor-not-allowed disabled:opacity-40" aria-label="Detach conversation">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  {!selected.linked_channels.length ? <p className="col-span-full py-4 text-center text-xs text-[var(--omnix-text-3)]">No operational channels attached.</p> : null}
                </div>
              </div>
            </details>

            <details className="group/disclosure overflow-hidden rounded-2xl border border-[var(--omnix-border)] bg-black/5 transition-all">
              <summary className="flex cursor-pointer items-center justify-between p-4 hover:bg-white/[0.02]">
                <div className="flex items-center gap-3">
                  <Link2 className="h-4 w-4 text-[var(--omnix-text-3)]" />
                  <span className="text-sm font-medium text-white">Resources & Decisions</span>
                  <span className="rounded-full bg-black/30 px-2 py-0.5 text-[10px] text-[var(--omnix-text-3)]">{selected.linked_resources.length} items</span>
                </div>
                <ArrowRight className="h-4 w-4 text-[var(--omnix-text-3)] transition-transform group-open/disclosure:rotate-90" />
              </summary>
              <div className="space-y-4 border-t border-[var(--omnix-border)] p-4">
                <form onSubmit={onAddResource} className="flex flex-wrap gap-2">
                  <select
                    value={resourceType}
                    disabled={updating}
                    onChange={(event) => onResourceTypeChange(event.target.value as WorkspaceInitiativeResource["resource_type"])}
                    className="omnix-input h-9 rounded-lg px-2 text-xs focus-visible:ring-2 focus-visible:ring-cyan-300/70"
                  >
                    <option value="decision">Decision</option>
                    <option value="file">File</option>
                    <option value="reference">Reference</option>
                    <option value="ai_session">AI context</option>
                  </select>
                  <Input value={resourceLabel} disabled={updating} onChange={(event) => onResourceLabelChange(event.target.value)} placeholder="Label" className="h-9 min-w-[8rem] flex-1 text-xs" />
                  <Input value={resourceId} disabled={updating} onChange={(event) => onResourceIdChange(event.target.value)} placeholder="Record id or reference" className="h-9 min-w-[10rem] flex-1 text-xs" />
                  <Button type="submit" size="sm" variant="secondary" disabled={!resourceId.trim() || updating}>
                    Link Resource
                  </Button>
                </form>
                <div className="flex flex-wrap gap-2">
                  {selected.linked_resources.map((resource) => (
                    <button
                      key={`${resource.resource_type}-${resource.resource_id}`}
                      type="button"
                      disabled={updating}
                      onClick={() => onPatchInitiative({ linked_resources: selected.linked_resources.filter((item) => item !== resource) })}
                      className="inline-flex min-h-11 max-w-full items-center gap-2 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.06] px-3 text-left text-xs text-cyan-100/90 transition-colors hover:bg-cyan-300/10 disabled:cursor-not-allowed disabled:opacity-40"
                      title="Remove link"
                    >
                      <span className="shrink-0 text-[10px] font-bold uppercase text-cyan-400/60">{resource.resource_type}</span>
                      <span className="min-w-0 break-words">{resource.label || resource.resource_id}</span>
                      <X className="h-3 w-3 shrink-0 opacity-60" />
                    </button>
                  ))}
                  {!selected.linked_resources.length ? <p className="text-xs text-[var(--omnix-text-3)]">No resources linked.</p> : null}
                </div>
              </div>
            </details>
          </div>

          <div className={cn("space-y-4 lg:hidden", mobileTab !== "assist" && "hidden")}>
            <section className="omnix-panel rounded-xl p-4">
              <p className="mb-4 inline-flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em] text-purple-300/70">
                <Sparkles className="h-3.5 w-3.5" /> Mission Assist
              </p>
              <div className="grid gap-2">
                {Object.entries(initiativeAssistanceLabels).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    disabled={Boolean(assisting)}
                    onClick={() => onRequestAssistance(mode as WorkspaceInitiativeAssistanceMode)}
                    className="group flex items-center justify-between rounded-xl border border-purple-300/15 bg-purple-300/[0.03] px-4 py-3 text-left text-xs font-medium text-purple-100/90 transition hover:bg-purple-300/[0.08] disabled:opacity-40"
                  >
                    {label}
                    {assisting === mode ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5 opacity-40" />}
                  </button>
                ))}
              </div>
              {assistance ? (
                <div className="mt-4 rounded-xl border border-purple-300/20 bg-purple-300/[0.04] p-4">
                  <p className="whitespace-pre-wrap break-words text-xs leading-6 text-[var(--omnix-text)]">{assistance.content}</p>
                  <p className="mt-3 text-[10px] font-medium leading-relaxed text-[var(--omnix-text-3)]">
                    Read from {assistance.source_task_count} tasks and {assistance.source_message_count} messages.
                  </p>
                </div>
              ) : null}
            </section>
          </div>
        </>
      )}
    </main>
  );
}
