"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Loader2, Sparkles } from "lucide-react";
import { useAuth } from "@/lib/auth-context";

type AuthCardProps = {
  title: string;
  description: string;
  children: React.ReactNode;
};

export function AuthCard({ title, description, children }: AuthCardProps) {
  const router = useRouter();
  const { isConfigured, loading, session } = useAuth();

  useEffect(() => {
    if (isConfigured && !loading && session) {
      router.replace("/chat");
    }
  }, [isConfigured, loading, router, session]);

  if (isConfigured && (loading || session)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-canvas text-slate-300">
        <div className="flex items-center gap-3 text-sm">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-200" />
          Restoring session...
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-4 py-10 text-white">
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.28, ease: "easeOut" }}
        className="w-full max-w-md"
      >
        <Link href="/" className="mx-auto mb-8 flex w-fit items-center gap-3">
          <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
            <Sparkles className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold">Omnix</span>
        </Link>

        <section className="rounded-lg border border-white/10 bg-white/[0.05] p-6 shadow-soft sm:p-7">
          <div className="mb-6">
            <h1 className="text-2xl font-semibold tracking-tight text-white">
              {title}
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-400">
              {description}
            </p>
          </div>
          {children}
        </section>
      </motion.div>
    </main>
  );
}
