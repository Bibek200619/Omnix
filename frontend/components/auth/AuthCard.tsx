"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { BrainCircuit } from "lucide-react";

type AuthCardProps = {
  title: string;
  subtitle: string;
  children: ReactNode;
};

export function AuthCard({ title, subtitle, children }: AuthCardProps) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-[#0d0d0b] px-4 py-10 text-stone-50">
      <div className="surface-grid absolute inset-0 opacity-25" aria-hidden="true" />
      <motion.section
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.45, ease: "easeOut" }}
        className="relative w-full max-w-md rounded-lg border border-white/10 bg-stone-950/86 p-6 shadow-2xl shadow-black/35 backdrop-blur-xl sm:p-8"
      >
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-stone-200 transition hover:text-white"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-md bg-teal-300 text-stone-950">
            <BrainCircuit className="h-5 w-5" aria-hidden="true" />
          </span>
          Omnix AI
        </Link>
        <div className="mb-7">
          <h1 className="text-2xl font-semibold tracking-normal text-white sm:text-3xl">{title}</h1>
          <p className="mt-2 text-sm leading-6 text-stone-400">{subtitle}</p>
        </div>
        {children}
      </motion.section>
    </main>
  );
}
