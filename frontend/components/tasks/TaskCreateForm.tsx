import { useEffect, useRef, type FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { MentionTextarea } from "@/components/mentions/MentionTextarea";
import type {
  WorkspaceInitiative,
  WorkspaceMember,
  WorkspaceMentionMetadata,
  WorkspaceTaskStatus,
} from "@/lib/workspace-types";

type TaskPhase = {
  value: WorkspaceTaskStatus;
  label: string;
};

type TaskCreateFormProps = {
  title: string;
  description: string;
  descriptionMentions: WorkspaceMentionMetadata[];
  status: WorkspaceTaskStatus;
  ownerId: string;
  dueDate: string;
  initialBlocker: string;
  initiativeId: string;
  members: WorkspaceMember[];
  initiatives: WorkspaceInitiative[];
  phases: TaskPhase[];
  creating: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onCancel: () => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onDescriptionMentionsChange: (mentions: WorkspaceMentionMetadata[]) => void;
  onStatusChange: (value: WorkspaceTaskStatus) => void;
  onOwnerChange: (value: string) => void;
  onDueDateChange: (value: string) => void;
  onInitialBlockerChange: (value: string) => void;
  onInitiativeChange: (value: string) => void;
};

function shouldFocusTitleInput() {
  return typeof window !== "undefined" && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
}

export function TaskCreateForm({
  title,
  description,
  descriptionMentions,
  status,
  ownerId,
  dueDate,
  initialBlocker,
  initiativeId,
  members,
  initiatives,
  phases,
  creating,
  onSubmit,
  onCancel,
  onTitleChange,
  onDescriptionChange,
  onDescriptionMentionsChange,
  onStatusChange,
  onOwnerChange,
  onDueDateChange,
  onInitialBlockerChange,
  onInitiativeChange,
}: TaskCreateFormProps) {
  const titleInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!shouldFocusTitleInput()) return;
    const frame = window.requestAnimationFrame(() => {
      titleInputRef.current?.focus({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  return (
    <form onSubmit={onSubmit} className="mb-4 grid gap-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-3 sm:grid-cols-2">
      <Input
        ref={titleInputRef}
        value={title}
        disabled={creating}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Operational next step"
        className="h-10 text-sm sm:col-span-2"
      />
      <div className="sm:col-span-2">
        <MentionTextarea
          value={description}
          disabled={creating}
          onChange={onDescriptionChange}
          members={members}
          mentions={descriptionMentions}
          onMentionsChange={onDescriptionMentionsChange}
          placeholder="Context, expected outcome, or handoff"
          className="omnix-input min-h-[68px] w-full resize-none rounded-lg p-2.5 text-sm"
        />
      </div>
      <select
        value={status}
        disabled={creating}
        onChange={(event) => onStatusChange(event.target.value as WorkspaceTaskStatus)}
        className="omnix-input h-10 rounded-lg px-2 text-sm focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        {phases.map((phase) => (
          <option key={phase.value} value={phase.value}>
            {phase.label}
          </option>
        ))}
      </select>
      <select
        value={ownerId}
        disabled={creating}
        onChange={(event) => onOwnerChange(event.target.value)}
        className="omnix-input h-10 rounded-lg px-2 text-sm focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <option value="">Unassigned</option>
        {members.map((member) => (
          <option key={member.user_id} value={member.user_id}>
            {member.full_name || member.email || member.handle || member.user_id}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={dueDate}
        disabled={creating}
        onChange={(event) => onDueDateChange(event.target.value)}
        className="omnix-input h-10 rounded-lg px-2 text-sm"
      />
      <Input
        value={initialBlocker}
        disabled={creating}
        onChange={(event) => onInitialBlockerChange(event.target.value)}
        placeholder="Recorded blocker, optional"
        className="h-10 text-sm"
      />
      <select
        value={initiativeId}
        disabled={creating}
        onChange={(event) => onInitiativeChange(event.target.value)}
        className="omnix-input h-10 rounded-lg px-2 text-sm focus-visible:ring-2 focus-visible:ring-cyan-300/70 sm:col-span-2"
      >
        <option value="">No initiative link</option>
        {initiatives.map((initiative) => (
          <option key={initiative.id} value={initiative.id}>
            {initiative.title}
          </option>
        ))}
      </select>
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Button type="button" size="sm" variant="ghost" disabled={creating} onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" size="sm" isLoading={creating} disabled={creating || !title.trim()}>
          Create record
        </Button>
      </div>
    </form>
  );
}
