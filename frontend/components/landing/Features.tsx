"use client";

import { motion } from "framer-motion";
import { Brain, History, KeyRound, MessageSquareText } from "lucide-react";

const features = [
  {
    icon: MessageSquareText,
    title: "Source-aware chat",
    description:
      "A focused conversation surface for answers, analysis, follow-ups, markdown, and code-heavy responses.",
    color: "text-cyan-200",
  },
  {
    icon: KeyRound,
    title: "Secure accounts",
    description:
      "Supabase sign in, registration, persisted sessions, protected routes, and reliable logout flows.",
    color: "text-emerald-200",
  },
  {
    icon: History,
    title: "Searchable memory",
    description:
      "Find previous threads quickly, reopen the active conversation, and keep work moving across sessions.",
    color: "text-amber-200",
  },
  {
    icon: Brain,
    title: "Integration-ready",
    description:
      "Clean route groups, reusable UI, and API-aware states leave the frontend ready for FastAPI services.",
    color: "text-rose-200",
  },
];

export function Features() {
  return (
    <section id="features" className="bg-[#07090d] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-6xl">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-200/70">
            Features
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white sm:text-4xl">
            The core workspace, designed as a product
          </h2>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {features.map((feature, index) => {
            const Icon = feature.icon;
            return (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, amount: 0.4 }}
                transition={{ duration: 0.25, delay: index * 0.04 }}
                className="rounded-lg border border-white/10 bg-white/[0.04] p-5"
              >
                <Icon className={`h-6 w-6 ${feature.color}`} />
                <h3 className="mt-5 text-base font-semibold text-white">
                  {feature.title}
                </h3>
                <p className="mt-3 text-sm leading-6 text-slate-400">
                  {feature.description}
                </p>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
