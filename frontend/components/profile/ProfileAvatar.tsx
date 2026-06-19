"use client";

import { cn } from "@/lib/utils";
import { initialsFromText } from "@/lib/workspace-roles";

type ProfileAvatarProps = {
  name?: string | null;
  email?: string | null;
  handle?: string | null;
  avatarUrl?: string | null;
  className?: string;
  imageClassName?: string;
};

export function ProfileAvatar({
  name,
  email,
  handle,
  avatarUrl,
  className,
  imageClassName,
}: ProfileAvatarProps) {
  const label = initialsFromText(name || handle || email || "User");

  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full border border-[var(--omnix-border)] bg-[var(--omnix-surface)] text-sm font-semibold text-slate-100",
        className,
      )}
      title={name || handle || email || "User"}
    >
      {avatarUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className={cn("h-full w-full object-cover", imageClassName)}
        />
      ) : (
        label
      )}
    </span>
  );
}
