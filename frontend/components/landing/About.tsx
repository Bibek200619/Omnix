"use client";

import { motion } from "framer-motion";
import { Database, LockKeyhole, Workflow } from "lucide-react";

const points = [
  {
    icon: Database,
    label: "FastAPI RAG backend",
    copy: "The interface is shaped around conversation IDs, messages, and future source metadata.",
  },
  {
    icon: LockKeyhole,
    label: "Supabase identity",
    copy: "Auth screens are intentionally thin so Supabase calls can replace mock redirects cleanly.",
  },
  {
    icon: Workflow,
    label: "Composable frontend",
    copy: "Pages stay small while UI, layout, auth, landing, and chat components live in clear folders.",
  },
];

export function About() {
  return (
    <section id="about" className="border-y border-white/10 bg-canvas px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-6xl gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-center">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-emerald-200/70">
            About
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            Built as the frontend layer Omnix was missing
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-400">
            Omnix already has a modular backend with chat, conversations,
            messages, Supabase, and a RAG pipeline. This UI gives it the
            product surface: clear routes, dependable interactions, and dark
            SaaS styling that can grow with real API calls.
          </p>
        </div>
        <div className="grid gap-4">
          {points.map((point, index) => {
            const Icon = point.icon;
            return (
              <motion.div
                key={point.label}
                initial={{ opacity: 0, x: 18 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true, amount: 0.5 }}
                transition={{ duration: 0.24, delay: index * 0.05 }}
                className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
              >
                <div className="flex gap-4">
                  <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-black/20 text-cyan-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-semibold text-white">{point.label}</h3>
                    <p className="mt-2 text-sm leading-6 text-slate-400">
                      {point.copy}
                    </p>
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
