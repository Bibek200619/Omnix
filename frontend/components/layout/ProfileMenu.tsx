"use client";

import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { LogOut, Settings, UserRound } from "lucide-react";
import { useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { initialsFromText } from "@/lib/workspace-roles";

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
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const displayName = userDisplayName(user);
  const email = user?.email ?? "";
  const initials = initialsFromText(displayName || email);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
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

  function goToSettings(hash?: string) {
    setOpen(false);
    router.push(hash ? `/settings${hash}` : "/settings");
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
          "flex h-10 w-10 items-center justify-center rounded-full border text-sm font-semibold shadow-[0_10px_30px_rgba(0,0,0,0.24)] transition",
          open
            ? "border-cyan-300/45 bg-cyan-300/15 text-cyan-50 ring-2 ring-cyan-300/20"
            : "border-white/12 bg-white/[0.075] text-slate-100 hover:border-cyan-300/35 hover:bg-white/[0.11]",
        )}
      >
        {initials}
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 top-full z-[110] mt-2 w-64 overflow-hidden rounded-lg border border-white/12 bg-[#05070b] shadow-[0_24px_70px_rgba(0,0,0,0.68)] ring-1 ring-black/40"
        >
          <div className="border-b border-white/8 px-4 py-3">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full border border-cyan-300/30 bg-cyan-300/12 text-sm font-semibold text-cyan-50">
                {initials}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{displayName}</div>
                {email ? <div className="mt-0.5 truncate text-xs text-slate-500">{email}</div> : null}
              </div>
            </div>
          </div>

          <div className="p-1.5">
            <button
              type="button"
              role="menuitem"
              onClick={() => goToSettings("#profile")}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              <UserRound className="h-4 w-4 text-cyan-200" />
              Profile
            </button>
            <button
              type="button"
              role="menuitem"
              onClick={() => goToSettings()}
              className="flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-left text-sm text-slate-300 transition hover:bg-white/[0.07] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/60"
            >
              <Settings className="h-4 w-4 text-slate-400" />
              Settings
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
      ) : null}
    </div>
  );
}
