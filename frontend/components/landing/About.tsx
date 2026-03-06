"use client";

import { motion } from "framer-motion";
import { Database, LockKeyhole, Workflow } from "lucide-react";

const points = [
  {
    icon: Database,
    label: "Knowledge retrieval",
    copy: "Conversation IDs, messages, and source metadata have a clear path into the FastAPI backend.",
  },
  {
    icon: LockKeyhole,
    label: "Identity first",
    copy: "Every protected screen depends on the active Supabase session before workspace data is requested.",
  },
  {
    icon: Workflow,
    label: "Composable UI",
    copy: "Small pages and reusable components make future billing, teams, files, and admin views straightforward.",
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
            Built for teams that need answers they can trust
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-400">
            Omnix gives operators, support teams, and builders a secure place to
            ask questions against private knowledge. The experience stays calm,
            fast, and legible so the AI can be useful in daily workflows rather
            than becoming another noisy tool.
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
