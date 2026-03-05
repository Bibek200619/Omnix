"use client";

import { motion } from "framer-motion";

const stats = [
  { label: "Core routes", value: "7" },
  { label: "Shared shell", value: "1" },
  { label: "Backend lock-in", value: "0" }
];

export function About() {
  return (
    <section id="about" className="border-b border-white/10 bg-[#0d0d0b] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div>
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-amber-200/90">About</p>
          <h2 className="mt-3 text-3xl font-semibold text-white sm:text-4xl">
            A frontend foundation for an AI SaaS that can grow.
          </h2>
          <p className="mt-5 text-base leading-8 text-stone-400">
            Omnix keeps authentication, chat, history, and settings separated into focused components. That
            makes the current UI easy to understand and the next backend step straightforward to integrate.
          </p>
        </div>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: "-80px" }}
          transition={{ duration: 0.4 }}
          className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1"
        >
          {stats.map((stat) => (
            <div key={stat.label} className="rounded-lg border border-white/10 bg-white/[0.045] p-5">
              <p className="text-3xl font-semibold text-white">{stat.value}</p>
              <p className="mt-1 text-sm text-stone-400">{stat.label}</p>
            </div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
