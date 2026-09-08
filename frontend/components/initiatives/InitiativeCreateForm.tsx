import type { FormEvent } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Textarea } from "@/components/ui/Textarea";
import type { WorkspaceMember } from "@/lib/workspace-types";

type InitiativeCreateFormProps = {
  title: string;
  description: string;
  ownerId: string;
  targetDate: string;
  context: string;
  members: WorkspaceMember[];
  creating: boolean;
  disabled: boolean;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTitleChange: (value: string) => void;
  onDescriptionChange: (value: string) => void;
  onOwnerChange: (value: string) => void;
  onTargetDateChange: (value: string) => void;
  onContextChange: (value: string) => void;
};

export function InitiativeCreateForm({
  title,
  description,
  ownerId,
  targetDate,
  context,
  members,
  creating,
  disabled,
  onSubmit,
  onTitleChange,
  onDescriptionChange,
  onOwnerChange,
  onTargetDateChange,
  onContextChange,
}: InitiativeCreateFormProps) {
  return (
    <form onSubmit={onSubmit} className="mb-3 space-y-2 rounded-xl border border-cyan-300/15 bg-cyan-300/[0.035] p-3">
      <Input
        value={title}
        disabled={disabled || creating}
        onChange={(event) => onTitleChange(event.target.value)}
        placeholder="Investor demo"
        className="h-9 text-sm"
        autoFocus
      />
      <Textarea
        aria-label="Initiative shared outcome"
        value={description}
        disabled={disabled || creating}
        onChange={(event) => onDescriptionChange(event.target.value)}
        placeholder="Shared outcome"
        className="h-16 !min-h-16 p-2 text-xs"
      />
      <select
        value={ownerId}
        disabled={disabled || creating}
        onChange={(event) => onOwnerChange(event.target.value)}
        className="omnix-input h-9 w-full rounded-lg px-2 text-xs focus-visible:ring-2 focus-visible:ring-cyan-300/70"
      >
        <option value="">No owner recorded</option>
        {members.map((member) => (
          <option key={member.user_id} value={member.user_id}>
            {member.full_name || member.email || member.user_id}
          </option>
        ))}
      </select>
      <input
        type="date"
        value={targetDate}
        disabled={disabled || creating}
        onChange={(event) => onTargetDateChange(event.target.value)}
        className="omnix-input h-9 w-full rounded-lg px-2 text-xs"
      />
      <Textarea
        aria-label="Initiative planning context"
        value={context}
        disabled={disabled || creating}
        onChange={(event) => onContextChange(event.target.value)}
        placeholder="Planning context, optional"
        className="h-16 !min-h-16 p-2 text-xs"
      />
      <Button type="submit" size="sm" className="w-full" isLoading={creating} disabled={disabled || !title.trim()}>
        Create initiative
      </Button>
    </form>
  );
}
