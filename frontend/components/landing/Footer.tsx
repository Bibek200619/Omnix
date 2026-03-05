"use client";

import { BrainCircuit } from "lucide-react";
import { useRouter } from "next/navigation";

const links = [
  { label: "Chat", href: "/chat" },
  { label: "History", href: "/history" },
  { label: "Settings", href: "/settings" },
  { label: "Terms", href: "/settings/terms" }
];

export function Footer() {
  const router = useRouter();

  return (
    <footer className="border-t border-white/10 bg-[#0d0d0b] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <button type="button" onClick={() => router.push("/")} className="flex items-center gap-3 text-left">
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-300 text-stone-950">
            <BrainCircuit className="h-5 w-5" aria-hidden="true" />
          </span>
          <span>
            <span className="block text-sm font-semibold text-white">Omnix AI</span>
            <span className="block text-xs text-stone-500">AI SaaS frontend</span>
          </span>
        </button>
        <nav className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-stone-400" aria-label="Footer">
          {links.map((link) => (
            <button
              key={link.href}
              type="button"
              onClick={() => router.push(link.href)}
              className="transition hover:text-white"
            >
              {link.label}
            </button>
          ))}
        </nav>
      </div>
    </footer>
  );
}
