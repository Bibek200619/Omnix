"use client";

import { motion } from "framer-motion";
import { History, LockKeyhole, MessageSquareText } from "lucide-react";

const features = [
  {
    icon: MessageSquareText,
    title: "Grounded chat",
    description: "A responsive RAG chat interface with message state, loading feedback, and send-on-Enter."
  },
  {
    icon: LockKeyhole,
    title: "Auth-ready flows",
    description: "Login, registration, and OTP verification are wired for Supabase integration."
  },
  {
    icon: History,
    title: "Conversation memory",
    description: "History and settings pages give the application a complete SaaS navigation model."
  }
];

export function Features() {
  return (
    <section id="features" className="border-b border-white/10 bg-[#11110f] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-200/80">Features</p>
          <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">Built for the product path.</h2>
          <p className="mt-4 text-base leading-7 text-stone-400">
            The interface keeps today’s frontend simple while leaving clear connection points for your backend.
          </p>
        </div>
        <div className="mt-10 grid gap-4 md:grid-cols-3">
          {features.map((feature, index) => {
            const Icon = feature.icon;

            return (
              <motion.article
                key={feature.title}
                initial={{ opacity: 0, y: 18 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true, margin: "-80px" }}
                transition={{ duration: 0.35, delay: index * 0.08 }}
                className="rounded-lg border border-white/10 bg-white/[0.045] p-6"
              >
                <span className="flex h-11 w-11 items-center justify-center rounded-md bg-teal-300 text-stone-950">
                  <Icon className="h-5 w-5" aria-hidden="true" />
                </span>
                <h3 className="mt-5 text-lg font-semibold text-white">{feature.title}</h3>
                <p className="mt-3 text-sm leading-6 text-stone-400">{feature.description}</p>
              </motion.article>
            );
          })}
        </div>
      </div>
    </section>
  );
}
