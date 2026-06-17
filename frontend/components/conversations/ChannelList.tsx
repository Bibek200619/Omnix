"use client";

import type { FormEvent } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Skeleton } from "@/components/ui/Skeleton";
import { Textarea } from "@/components/ui/Textarea";
import { cn } from "@/lib/utils";
import type { WorkspaceChannel } from "@/lib/workspace-types";

type ChannelListProps = {
  channelName: string;
  channelPurpose: string;
  channels: WorkspaceChannel[];
  channelsLoading: boolean;
  createOpen: boolean;
  creatingChannel: boolean;
  mayCreateChannel: boolean;
  onCreateChannel: (event: FormEvent<HTMLFormElement>) => void;
  onSelectChannel: (channelId: string) => void;
  selectedChannelId: string | null;
  setChannelName: (value: string) => void;
  setChannelPurpose: (value: string) => void;
  setCreateOpen: (value: boolean | ((open: boolean) => boolean)) => void;
};

export function ChannelList({
  channelName,
  channelPurpose,
  channels,
  channelsLoading,
  createOpen,
  creatingChannel,
  mayCreateChannel,
  onCreateChannel,
  onSelectChannel,
  selectedChannelId,
  setChannelName,
  setChannelPurpose,
  setCreateOpen,
}: ChannelListProps) {
  return (
    <aside className="omnix-panel flex min-w-0 shrink-0 flex-col overflow-hidden rounded-xl p-3 lg:min-h-0">
      <div className="mb-3 flex items-center justify-between px-1">
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[var(--omnix-text-3)]">Channels</p>
        {mayCreateChannel ? (
          <button
            type="button"
            onClick={() => setCreateOpen((open) => !open)}
            className="rounded-md p-1 text-cyan-100/70 hover:bg-cyan-300/10 hover:text-cyan-100"
            aria-label="Create channel"
          >
            <Plus className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {createOpen ? (
        <form onSubmit={onCreateChannel} className="mb-3 space-y-2 rounded-lg border border-cyan-300/15 bg-cyan-300/[0.04] p-2.5">
          <Input value={channelName} onChange={(event) => setChannelName(event.target.value)} placeholder="backend" className="h-9 text-sm" autoFocus />
          <Textarea
            aria-label="Channel purpose"
            value={channelPurpose}
            onChange={(event) => setChannelPurpose(event.target.value)}
            placeholder="Operational purpose"
            className="h-16 !min-h-16 p-2 text-xs"
          />
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={!channelName.trim()} isLoading={creatingChannel} className="h-8 flex-1 text-xs">
              Open
            </Button>
            <Button type="button" size="sm" variant="ghost" className="h-8 text-xs" onClick={() => setCreateOpen(false)}>
              Cancel
            </Button>
          </div>
        </form>
      ) : null}

      <div className="omnix-scrollbar flex min-h-0 gap-2 overflow-x-auto pb-1 lg:block lg:flex-1 lg:space-y-1 lg:overflow-x-hidden lg:overflow-y-auto lg:pb-0">
        {channelsLoading ? (
          <>
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="w-[min(12rem,76vw)] shrink-0 rounded-lg border border-transparent px-3 py-2.5 lg:w-full">
                <div className="flex items-center justify-between gap-2">
                  <Skeleton variant="line" className="h-3.5 w-24" />
                  <Skeleton className="h-4 w-9 rounded" />
                </div>
                <Skeleton variant="line" className="mt-2 h-3 w-full" />
                <Skeleton variant="line" className="mt-2 h-2.5 w-20" />
              </div>
            ))}
          </>
        ) : null}
        {channels.map((channel) => (
          <button
            type="button"
            key={channel.id}
            onClick={() => onSelectChannel(channel.id)}
            className={cn(
              "w-[min(12rem,76vw)] min-w-0 shrink-0 rounded-lg border px-3 py-2.5 text-left transition lg:w-full",
              selectedChannelId === channel.id
                ? "border-cyan-300/25 bg-cyan-300/[0.08]"
                : "border-transparent hover:border-[var(--omnix-border)] hover:bg-[var(--omnix-surface)]",
            )}
          >
            <span className="flex items-center justify-between gap-2 text-sm font-medium text-white">
              <span className="truncate">{channel.name}</span>
              {channel.channel_type === "announcement" ? (
                <span className="rounded border border-amber-300/20 px-1 py-0.5 text-[9px] uppercase text-amber-100">brief</span>
              ) : null}
            </span>
            <span className="mt-1 block truncate text-[11px] text-[var(--omnix-text-3)]">
              {channel.last_message_preview || channel.purpose || "Ready for coordination"}
            </span>
          </button>
        ))}
      </div>
      <p className="mt-3 hidden border-t border-[var(--omnix-border)] px-1 pt-3 text-[11px] leading-5 text-[var(--omnix-text-3)] lg:block">
        Messages stay scoped to this workspace. Attention signals remain intentionally quiet.
      </p>
    </aside>
  );
}
