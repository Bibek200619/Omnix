"use client";

import Link from "next/link";
import type React from "react";
import type { WorkspaceMentionMetadata } from "@/lib/workspace-types";

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentionLabel(mention: WorkspaceMentionMetadata) {
  return (mention.label || mention.display_name || mention.email || mention.user_id).replace(/^@/, "").split(/\s+/)[0];
}

export function MentionText({
  content,
  mentions,
}: {
  content: string;
  mentions?: WorkspaceMentionMetadata[] | null;
}) {
  const mentionList = (mentions || []).filter((mention) => mention.user_id);
  const labels = Array.from(new Set(mentionList.map(mentionLabel).filter(Boolean))).sort((a, b) => b.length - a.length);
  if (!content || labels.length === 0) {
    return <>{content}</>;
  }

  const byLabel = new Map(mentionList.map((mention) => [mentionLabel(mention).toLowerCase(), mention]));
  const matcher = new RegExp(`@(${labels.map(escapeRegex).join("|")})(?=\\b|$)`, "gi");
  const parts: React.ReactNode[] = [];
  let cursor = 0;

  for (const match of content.matchAll(matcher)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      parts.push(content.slice(cursor, index));
    }
    const label = match[1] || "";
    const mention = byLabel.get(label.toLowerCase());
    if (mention) {
      parts.push(
        <Link
          key={`${mention.user_id}-${index}`}
          href={`/team?member=${encodeURIComponent(mention.user_id)}`}
          className="inline-flex min-h-6 items-center rounded-md border border-cyan-300/14 bg-cyan-300/[0.065] px-1.5 py-0.5 font-medium text-cyan-100 transition hover:border-cyan-300/25 hover:bg-cyan-300/[0.1]"
          title={mention.operational_label || mention.display_name || mention.email || "Workspace member"}
        >
          @{label}
        </Link>,
      );
    } else {
      parts.push(match[0]);
    }
    cursor = index + match[0].length;
  }

  if (cursor < content.length) {
    parts.push(content.slice(cursor));
  }

  return <>{parts}</>;
}
