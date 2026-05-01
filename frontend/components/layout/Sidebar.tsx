"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  BrainCircuit,
  History,
  LogOut,
  MessageSquareText,
  Settings,
  Sparkles,
  X
} from "lucide-react";
import { Button } from "@/components/ui/Button";
import { cn } from "@/lib/utils";

type SidebarProps = {
  open: boolean;
  onClose: () => void;
};

const navItems = [
  { href: "/chat", label: "Chat", icon: MessageSquareText },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings }
];

export function Sidebar({ open, onClose }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <>
      <div
        className={cn(
          "fixed inset-0 z-40 bg-black/60 backdrop-blur-sm transition-opacity lg:hidden",
          open ? "opacity-100" : "pointer-events-none opacity-0"
        )}
        onClick={onClose}
        aria-hidden="true"
      />
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-72 flex-col border-r border-white/10 bg-[#11110f]/95 px-4 py-4 shadow-2xl shadow-black/30 backdrop-blur-xl transition-transform duration-250 lg:translate-x-0",
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex items-center justify-between">
          <Link href="/" className="flex items-center gap-3" onClick={onClose}>
            <span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-300 text-stone-950">
              <BrainCircuit className="h-5 w-5" aria-hidden="true" />
            </span>
            <span>
              <span className="block text-sm font-semibold text-white">Omnix AI</span>
              <span className="block text-xs text-stone-400">Grounded assistant</span>
            </span>
          </Link>
          <Button variant="ghost" size="icon" className="lg:hidden" onClick={onClose} aria-label="Close menu">
            <X className="h-5 w-5" aria-hidden="true" />
          </Button>
        </div>

        <Button className="mt-7" fullWidth onClick={() => router.push("/chat")}>
          <Sparkles className="h-4 w-4" aria-hidden="true" />
          New chat
        </Button>

        <nav className="mt-7 space-y-1" aria-label="Main navigation">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive =
              pathname === item.href || (item.href !== "/chat" && pathname.startsWith(item.href));

            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={onClose}
                className={cn(
                  "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition",
                  isActive
                    ? "bg-white/[0.09] text-white"
                    : "text-stone-400 hover:bg-white/[0.06] hover:text-stone-100"
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="mt-auto rounded-lg border border-white/10 bg-white/[0.045] p-4">
          <p className="text-sm font-medium text-stone-100">Backend ready</p>
          <p className="mt-1 text-xs leading-5 text-stone-400">
            UI flows are wired locally and ready for Supabase and RAG endpoints.
          </p>
        </div>

        <Button
          variant="ghost"
          className="mt-3 justify-start text-stone-400"
          onClick={() => router.push("/login")}
        >
          <LogOut className="h-4 w-4" aria-hidden="true" />
          Sign out
        </Button>
      </aside>
    </>
  );
}
