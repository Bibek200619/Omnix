"use client";

import Link from "next/link";
import { Sparkles } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-white/10 bg-canvas px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="font-semibold text-white">Omnix</span>
        </Link>
        <div className="flex flex-wrap gap-4 text-sm text-slate-400">
          <Link href="/login" className="hover:text-white">
            Login
          </Link>
          <Link href="/register" className="hover:text-white">
            Register
          </Link>
          <Link href="/settings/terms" className="hover:text-white">
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
}
