"use client";

import { motion } from "framer-motion";
import { ArrowRight, BrainCircuit, CheckCircle2, LogIn, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

function HeroScene() {
  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden="true">
      <div className="surface-grid absolute inset-0 opacity-25" />
      <div className="absolute inset-0 bg-[linear-gradient(90deg,#0d0d0b_0%,rgba(13,13,11,0.78)_34%,rgba(13,13,11,0.52)_100%)]" />
      <motion.div
        initial={{ opacity: 0, y: 24, rotate: -2 }}
        animate={{ opacity: 0.92, y: 0, rotate: -2 }}
        transition={{ duration: 0.75, ease: "easeOut" }}
        className="absolute left-[8%] top-[19rem] h-44 w-[30rem] rounded-lg border border-white/10 bg-[#171713]/85 p-4 shadow-2xl shadow-black/30 backdrop-blur-md sm:top-[23rem] lg:left-auto lg:right-[18%] lg:top-28 lg:h-72 lg:w-[42rem]"
      >
        <div className="flex items-center justify-between border-b border-white/10 pb-3">
          <div className="flex items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-full bg-rose-300" />
            <span className="h-2.5 w-2.5 rounded-full bg-amber-200" />
            <span className="h-2.5 w-2.5 rounded-full bg-teal-300" />
          </div>
          <span className="rounded-md bg-teal-300/14 px-2 py-1 text-xs font-medium text-teal-100">
            RAG ready
          </span>
        </div>
        <div className="grid h-[calc(100%-2.5rem)] grid-cols-[9rem_1fr] gap-4 pt-4 lg:grid-cols-[12rem_1fr]">
          <div className="space-y-2 border-r border-white/10 pr-4">
            {["Chat", "History", "Settings"].map((item, index) => (
              <div
                key={item}
                className={`h-8 rounded-md px-3 py-2 text-xs ${
                  index === 0 ? "bg-teal-300 text-stone-950" : "bg-white/[0.06] text-stone-300"
                }`}
              >
                {item}
              </div>
            ))}
          </div>
          <div className="space-y-3">
            <div className="mr-10 rounded-lg border border-white/10 bg-white/[0.06] p-3 text-xs leading-5 text-stone-300">
              Search the internal launch docs and cite the answer.
            </div>
            <div className="ml-8 rounded-lg bg-teal-300 p-3 text-xs leading-5 text-stone-950">
              Found 4 relevant chunks. Drafting a grounded answer with confidence markers.
            </div>
            <div className="grid grid-cols-3 gap-2">
              {[68, 84, 52].map((width, index) => (
                <motion.span
                  key={index}
                  className="h-2 rounded-full bg-white/16"
                  style={{ width: `${width}%` }}
                  animate={{ opacity: [0.35, 0.85, 0.35] }}
                  transition={{ duration: 1.4, repeat: Infinity, delay: index * 0.18 }}
                />
              ))}
            </div>
          </div>
        </div>
      </motion.div>
      <motion.div
        initial={{ opacity: 0, y: 18, rotate: 3 }}
        animate={{ opacity: 0.72, y: 0, rotate: 3 }}
        transition={{ duration: 0.7, delay: 0.12, ease: "easeOut" }}
        className="absolute right-[-6rem] top-[29rem] hidden h-56 w-[27rem] rounded-lg border border-white/10 bg-[#171713]/80 p-4 shadow-2xl shadow-black/30 backdrop-blur-md md:block lg:right-10 lg:top-[25rem]"
      >
        <div className="flex items-center justify-between text-xs text-stone-400">
          <span>Answer quality</span>
          <span>92%</span>
        </div>
        <div className="mt-4 space-y-3">
          {["Grounded response", "Source coverage", "Auth session"].map((item, index) => (
            <div key={item} className="flex items-center gap-3">
              <CheckCircle2 className="h-4 w-4 text-teal-200" aria-hidden="true" />
              <span className="text-sm text-stone-200">{item}</span>
              <span className="ml-auto h-2 w-20 rounded-full bg-white/10">
                <span
                  className="block h-full rounded-full bg-amber-200"
                  style={{ width: `${82 - index * 12}%` }}
                />
              </span>
            </div>
          ))}
        </div>
      </motion.div>
    </div>
  );
}

export function Hero() {
  const router = useRouter();

  return (
    <section className="relative min-h-[84svh] overflow-hidden border-b border-white/10 bg-[#0d0d0b]">
      <HeroScene />
      <nav className="relative z-10 mx-auto flex max-w-7xl items-center justify-between px-4 py-5 sm:px-6 lg:px-8">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-3 text-left"
          aria-label="Go to home"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-md bg-teal-300 text-stone-950">
            <BrainCircuit className="h-5 w-5" aria-hidden="true" />
          </span>
          <span className="font-semibold text-white">Omnix AI</span>
        </button>
        <div className="flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push("/login")}>
            <LogIn className="h-4 w-4" aria-hidden="true" />
            Login
          </Button>
          <Button variant="secondary" onClick={() => router.push("/register")}>
            <UserPlus className="h-4 w-4" aria-hidden="true" />
            Register
          </Button>
        </div>
      </nav>
      <div className="relative z-10 mx-auto flex max-w-7xl flex-col px-4 pb-20 pt-16 sm:px-6 sm:pt-20 lg:px-8 lg:pt-24">
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: "easeOut" }}
          className="max-w-3xl"
        >
          <span className="inline-flex rounded-md border border-teal-200/25 bg-teal-200/10 px-3 py-1 text-sm font-medium text-teal-100">
            RAG chat, auth, and history in one production-ready shell
          </span>
          <h1 className="mt-6 text-5xl font-semibold tracking-normal text-white sm:text-6xl lg:text-7xl">
            Omnix AI
          </h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-stone-300">
            A clean AI SaaS frontend for grounded conversations, Supabase-ready authentication,
            account settings, and chat history workflows.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button size="lg" onClick={() => router.push("/login")}>
              Get Started
              <ArrowRight className="h-5 w-5" aria-hidden="true" />
            </Button>
            <Button size="lg" variant="secondary" onClick={() => router.push("/register")}>
              Register
            </Button>
          </div>
        </motion.div>
      </div>
    </section>
  );
}
