"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  Check,
  Database,
  Globe2,
  Loader2,
  LockKeyhole,
  MessageSquareText,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UsersRound,
} from "lucide-react";
import { OmnixMark } from "@/components/brand/OmnixMark";
import { redirectFromWindow } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";

type AuthCardProps = {
  title: string;
  description: string;
  children: React.ReactNode;
  mode?: "login" | "register";
};

const trustItems = [
  "Secure authenticated sessions",
  "Workspace roles preserved",
  "Documents, web, and RAG ready",
];

const previewItems = [
  { icon: MessageSquareText, label: "AI chat", color: "text-cyan-200" },
  { icon: UploadCloud, label: "Uploads", color: "text-indigo-200" },
  { icon: Globe2, label: "Live web", color: "text-emerald-200" },
  { icon: UsersRound, label: "Teams", color: "text-amber-200" },
];

export function AuthCard({
  title,
  description,
  children,
  mode = "login",
}: AuthCardProps) {
  const router = useRouter();
  const { isConfigured, loading, session } = useAuth();

  useEffect(() => {
    if (isConfigured && !loading && session) {
      router.replace(redirectFromWindow());
    }
  }, [isConfigured, loading, router, session]);

  if (isConfigured && (loading || session)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#061020] text-slate-300">
        <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3 text-sm shadow-soft">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-200" aria-hidden="true" />
          Restoring session...
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#061020] px-4 py-8 text-white sm:px-6 lg:px-8">
      <div
        aria-hidden="true"
        className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.035)_1px,transparent_1px)] bg-[size:56px_56px]"
      />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(ellipse_at_50%_0%,rgba(34,211,238,0.15),rgba(0,85,255,0.06)_38%,transparent_72%)]"
      />
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.38, ease: "easeOut" }}
        className="relative z-10 grid w-full max-w-6xl overflow-hidden rounded-lg border border-cyan-300/14 bg-[#07111f]/94 shadow-[0_44px_140px_rgba(0,0,0,0.58),0_0_90px_rgba(34,211,238,0.09)] backdrop-blur-xl lg:grid-cols-[1.05fr_0.95fr]"
      >
        <section className="relative hidden min-h-[680px] overflow-hidden border-r border-white/[0.06] bg-white/[0.025] p-8 lg:flex lg:flex-col">
          <div
            aria-hidden="true"
            className="absolute inset-0 bg-[linear-gradient(rgba(34,211,238,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.035)_1px,transparent_1px)] bg-[size:48px_48px]"
          />
          <div
            aria-hidden="true"
            className="absolute inset-x-0 top-0 h-64 bg-[radial-gradient(ellipse_at_50%_0%,rgba(34,211,238,0.12),transparent_68%)]"
          />
          <div className="relative z-10 flex items-center justify-between">
            <Link href="/" className="flex items-center gap-3" aria-label="Omnix home">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10">
                <OmnixMark size={28} />
              </span>
              <span className="text-sm font-black uppercase tracking-[0.18em] text-white">
                Omnix
              </span>
            </Link>
            <span className="rounded-full border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-1 text-xs font-semibold text-emerald-200">
              Synced
            </span>
          </div>

          <div className="relative z-10 mt-14 max-w-md">
            <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-1 text-[11px] font-black uppercase tracking-[0.16em] text-cyan-200">
              <span className="h-1.5 w-1.5 rounded-full bg-cyan-300" />
              {mode === "register" ? "Start your workspace" : "Welcome back"}
            </div>
            <h2 className="text-balance text-4xl font-black leading-tight tracking-normal text-white">
              Hybrid AI workspace intelligence, ready when your team signs in.
            </h2>
            <p className="mt-5 text-sm leading-7 text-slate-400">
              Omnix combines uploaded documents, semantic retrieval, shared chat,
              live web research, and team collaboration in one secure workspace.
            </p>
          </div>

          <div className="relative z-10 mt-10 grid grid-cols-2 gap-3">
            {previewItems.map(({ icon: Icon, label, color }) => (
              <div key={label} className="rounded-lg border border-white/[0.075] bg-white/[0.035] p-4">
                <Icon className={`h-5 w-5 ${color}`} aria-hidden="true" />
                <p className="mt-3 text-sm font-bold text-white">{label}</p>
                <div className="mt-3 h-1.5 rounded-full bg-white/10" />
              </div>
            ))}
          </div>

          <div className="relative z-10 mt-auto rounded-lg border border-cyan-300/14 bg-[#061020]/70 p-5">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/18 bg-cyan-300/[0.07] text-cyan-200">
                <Database className="h-5 w-5" aria-hidden="true" />
              </div>
              <div>
                <p className="text-sm font-black text-white">Research context</p>
                <p className="text-xs text-slate-500">Docs + web + workspace memory</p>
              </div>
            </div>
            <div className="space-y-3">
              {trustItems.map((item) => (
                <div key={item} className="flex items-center gap-3 text-sm text-slate-300">
                  <span className="flex h-5 w-5 items-center justify-center rounded-full border border-cyan-300/18 bg-cyan-300/[0.06] text-cyan-200">
                    <Check className="h-3 w-3" aria-hidden="true" />
                  </span>
                  {item}
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="relative flex min-h-[640px] flex-col px-5 py-7 sm:px-8 lg:px-10">
          <div className="mb-8 flex items-center justify-between lg:hidden">
            <Link href="/" className="flex items-center gap-3" aria-label="Omnix home">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10">
                <OmnixMark size={28} />
              </span>
              <span className="text-sm font-black uppercase tracking-[0.18em] text-white">
                Omnix
              </span>
            </Link>
            <Sparkles className="h-5 w-5 text-cyan-200" aria-hidden="true" />
          </div>

          <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center">
            <div className="mb-7">
              <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200">
                {mode === "register" ? (
                  <ShieldCheck className="h-6 w-6" aria-hidden="true" />
                ) : (
                  <LockKeyhole className="h-6 w-6" aria-hidden="true" />
                )}
              </div>
              <h1 className="text-3xl font-black tracking-normal text-white">
                {title}
              </h1>
              <p className="mt-3 text-sm leading-6 text-slate-400">
                {description}
              </p>
            </div>
            {children}
          </div>
        </section>
      </motion.div>
    </main>
  );
}
