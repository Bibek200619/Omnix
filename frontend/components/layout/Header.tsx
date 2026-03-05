"use client";

import { useMemo } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Menu, Plus, Search } from "lucide-react";
import { Button } from "@/components/ui/Button";

type HeaderProps = {
  onMenuClick: () => void;
};

const titles: Record<string, { title: string; eyebrow: string }> = {
  "/chat": {
    title: "Chat",
    eyebrow: "Ask with context"
  },
  "/history": {
    title: "History",
    eyebrow: "Recent conversations"
  },
  "/settings": {
    title: "Settings",
    eyebrow: "Profile and workspace"
  },
  "/settings/terms": {
    title: "Terms",
    eyebrow: "Service and usage"
  }
};

export function Header({ onMenuClick }: HeaderProps) {
  const pathname = usePathname();
  const router = useRouter();
  const page = useMemo(() => titles[pathname] ?? titles["/chat"], [pathname]);

  return (
    <header className="sticky top-0 z-30 border-b border-white/10 bg-[#0d0d0b]/82 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-3 px-4 sm:px-6 lg:px-8">
        <Button variant="ghost" size="icon" className="lg:hidden" onClick={onMenuClick} aria-label="Open menu">
          <Menu className="h-5 w-5" aria-hidden="true" />
        </Button>
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-[0.18em] text-teal-200/80">{page.eyebrow}</p>
          <h1 className="truncate text-lg font-semibold text-white">{page.title}</h1>
        </div>
        <div className="ml-auto hidden h-10 w-full max-w-xs items-center gap-2 rounded-md border border-white/10 bg-white/[0.045] px-3 text-sm text-stone-500 md:flex">
          <Search className="h-4 w-4" aria-hidden="true" />
          Search chats
        </div>
        <Button variant="secondary" onClick={() => router.push("/chat")} className="hidden sm:inline-flex">
          <Plus className="h-4 w-4" aria-hidden="true" />
          New chat
        </Button>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-md border border-white/10 bg-amber-200 text-sm font-semibold text-stone-950 transition hover:bg-amber-100"
          aria-label="Open profile"
          onClick={() => router.push("/settings")}
        >
          O
        </button>
      </div>
    </header>
  );
}
