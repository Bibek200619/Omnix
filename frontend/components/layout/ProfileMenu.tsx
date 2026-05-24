"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogOut, Settings, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { ProfileAvatar } from "@/components/profile/ProfileAvatar";
import { FloatingMenuLayer } from "@/components/ui/FloatingMenuLayer";
import { useProfile } from "@/lib/profile-context";
import { cn } from "@/lib/utils";

type ProfileMenuProps = {
  user: User | null;
  signingOut?: boolean;
  onSignOut: () => void;
};

function userDisplayName(user: User | null) {
  const metadata = user?.user_metadata ?? {};
  const name = metadata.full_name || metadata.name;
  return typeof name === "string" && name.trim() ? name.trim() : user?.email || "Profile";
}

export function ProfileMenu({ user, signingOut = false, onSignOut }: ProfileMenuProps) {
  const router = useRouter();
  const { profile } = useProfile();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuContentRef = useRef<HTMLDivElement | null>(null);
  const displayName = profile?.display_name || userDisplayName(user);
  const email = profile?.email || user?.email || "";
  const username = profile?.username || profile?.handle || null;
  const handle = username ? `@${username}` : null;

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (!menuRef.current?.contains(target) && !menuContentRef.current?.contains(target)) {
        setOpen(false);
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  function goTo(path: string) {
    setOpen(false);
    router.push(path);
  }

  return (
    <div ref={menuRef} className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open profile menu"
        title="Profile menu"
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-[34px] w-[34px] items-center justify-center rounded-full border text-sm font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.24)] transition",
          open
            ? "border-cyan-300/45 bg-[linear-gradient(135deg,#00FFFF,#0088ff)] text-[#050c17] shadow-[var(--omnix-glow-sm)] ring-2 ring-cyan-300/20"
            : "border-cyan-300/40 bg-[linear-gradient(135deg,#00FFFF,#0088ff)] text-[#050c17] hover:shadow-[var(--omnix-glow-sm)]",
        )}
      >
        <ProfileAvatar
          name={displayName}
          email={email}
          handle={username}
          avatarUrl={profile?.avatar_url}
          className="h-full w-full border-0 bg-transparent text-[#050c17]"
        />
      </button>

      {open ? (
        <FloatingMenuLayer anchorRef={menuRef} contentRef={menuContentRef} placement="bottom-end" width={256} zIndex={150}>
        <div
          role="menu"
          className="omnix-floating-card w-full overflow-hidden ring-1 ring-black/40"
        >
          <div className="border-b border-[var(--omnix-border)] px-4 py-3">
            <div className="flex items-center gap-3">
              <ProfileAvatar
                name={displayName}
                email={email}
                handle={username}
                avatarUrl={profile?.avatar_url}
                className="h-10 w-10 border-cyan-300/30 bg-cyan-300/12 text-cyan-50"
              />
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{displayName}</div>
                {email ? <div className="mt-0.5 truncate text-xs text-slate-500">{email}</div> : null}
                {handle ? <div className="mt-0.5 truncate text-xs font-medium text-cyan-200">{handle}</div> : null}
              </div>
            </div>
          </div>

          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => goTo("/settings/profile")}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-[var(--omnix-surface)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              <UserRound className="h-4 w-4 text-cyan-200" />
              Profile
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => goTo("/settings/workspace")}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-[var(--omnix-surface)] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              <Settings className="h-4 w-4 text-slate-400" />
              Workspace Settings
            </button>
          </div>

          <div className="border-t border-white/8 p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                onSignOut();
              }}
              disabled={signingOut}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-rose-100 transition hover:bg-rose-400/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-300/50 disabled:cursor-not-allowed disabled:opacity-55"
            >
              <LogOut className="h-4 w-4" />
              {signingOut ? "Signing out" : "Sign out"}
            </button>
          </div>
        </div>
        </FloatingMenuLayer>
      ) : null}
    </div>
  );
}
