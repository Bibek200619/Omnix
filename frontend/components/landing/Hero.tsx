"use client";

import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import {
  ArrowRight,
  LogIn,
  MessageSquare,
  Search,
  Shield,
  Sparkles,
} from "lucide-react";
import { Button } from "@/components/ui/Button";

export function Hero() {
  const router = useRouter();

  return (
    <section className="relative isolate min-h-[86vh] overflow-hidden border-b border-white/10 bg-canvas px-4 py-5 sm:px-6 lg:px-8">
      <nav className="relative z-20 mx-auto flex max-w-6xl items-center justify-between">
        <button
          type="button"
          onClick={() => router.push("/")}
          className="flex items-center gap-3 text-left"
        >
          <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/30 bg-cyan-300/10 text-cyan-200">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="font-semibold text-white">Omnix</span>
        </button>
        <div className="hidden items-center gap-6 text-sm text-slate-400 sm:flex">
          <a href="#features" className="transition hover:text-white">
            Features
          </a>
          <a href="#about" className="transition hover:text-white">
            About
          </a>
        </div>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          leftIcon={<LogIn className="h-4 w-4" />}
          onClick={() => router.push("/login")}
        >
          Sign in
        </Button>
      </nav>
      <div className="absolute inset-x-4 bottom-8 top-24 mx-auto max-w-6xl opacity-75">
        <motion.div
          aria-hidden="true"
          initial={{ opacity: 0, y: 24 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: "easeOut" }}
          className="h-full rounded-lg border border-white/10 bg-[#080a0f] p-3 shadow-soft"
        >
          <div className="grid h-full grid-cols-[0.8fr_1.4fr_0.8fr] gap-3">
            <div className="hidden rounded-lg border border-white/10 bg-white/[0.04] p-3 md:block">
              <div className="mb-4 h-2 w-20 rounded-full bg-cyan-200/60" />
              {["Knowledge", "Policies", "Tickets", "Runbooks"].map(
                (item, index) => (
                  <div
                    key={item}
                    className="mb-3 rounded-lg border border-white/10 bg-black/20 p-3"
                  >
                    <div className="flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-emerald-300" />
                      <span className="text-xs text-slate-400">{item}</span>
                    </div>
                    <div
                      className="mt-3 h-1.5 rounded-full bg-white/10"
                      style={{ width: `${82 - index * 12}%` }}
                    />
                  </div>
                ),
              )}
            </div>
            <div className="rounded-lg border border-cyan-300/20 bg-[#0b1118] p-3 sm:p-5">
              <div className="mb-4 flex items-center justify-between border-b border-white/10 pb-3">
                <div className="flex items-center gap-2 text-xs text-cyan-100">
                  <MessageSquare className="h-4 w-4" />
                  Omnix Chat
                </div>
                <div className="flex gap-1">
                  <span className="h-2 w-2 rounded-full bg-rose-300/70" />
                  <span className="h-2 w-2 rounded-full bg-amber-300/70" />
                  <span className="h-2 w-2 rounded-full bg-emerald-300/70" />
                </div>
              </div>
              <div className="space-y-3">
                <div className="max-w-[72%] rounded-lg border border-white/10 bg-white/[0.06] p-3">
                  <p className="text-xs leading-5 text-slate-300">
                    Which onboarding steps are blocking enterprise rollout?
                  </p>
                </div>
                <div className="ml-auto max-w-[70%] rounded-lg border border-emerald-300/20 bg-emerald-300/10 p-3">
                  <p className="text-xs leading-5 text-emerald-50">
                    Compare the launch checklist with the current security review.
                  </p>
                </div>
                <div className="max-w-[78%] rounded-lg border border-white/10 bg-white/[0.06] p-3">
                  <div className="mb-2 flex items-center gap-2 text-xs text-amber-100">
                    <Search className="h-3.5 w-3.5" />
                    Retrieved context
                  </div>
                  <div className="h-2 w-full rounded-full bg-white/10" />
                  <div className="mt-2 h-2 w-11/12 rounded-full bg-white/10" />
                  <div className="mt-2 h-2 w-3/5 rounded-full bg-white/10" />
                </div>
              </div>
            </div>
            <div className="hidden rounded-lg border border-white/10 bg-white/[0.04] p-3 lg:block">
              <div className="flex items-center gap-2 text-xs text-slate-300">
                <Shield className="h-4 w-4 text-emerald-200" />
                Auth session
              </div>
              <div className="mt-5 space-y-3">
                {[88, 64, 76, 52].map((width, index) => (
                  <div key={width} className="rounded-lg bg-black/20 p-3">
                    <div
                      className="h-2 rounded-full bg-white/10"
                      style={{ width: `${width}%` }}
                    />
                    <div
                      className="mt-2 h-1.5 rounded-full bg-cyan-200/30"
                      style={{ width: `${50 + index * 8}%` }}
                    />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </motion.div>
      </div>

      <div className="relative z-10 mx-auto flex max-w-5xl flex-col items-center pt-12 text-center sm:pt-20">
        <motion.p
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
          className="rounded-lg border border-cyan-300/25 bg-cyan-300/10 px-3 py-1 text-xs font-medium uppercase tracking-[0.18em] text-cyan-100"
        >
          AI workspace for knowledge teams
        </motion.p>
        <motion.h1
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.06 }}
          className="mt-6 max-w-4xl text-5xl font-semibold tracking-tight text-white sm:text-6xl lg:text-7xl"
        >
          Omnix
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.12 }}
          className="mt-6 max-w-2xl text-base leading-8 text-slate-300 sm:text-lg"
        >
          Turn private knowledge into precise AI conversations with secure
          accounts, searchable history, and a workspace built for real operations.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.18 }}
          className="mt-8 flex flex-col gap-3 sm:flex-row"
        >
          <Button
            type="button"
            size="lg"
            rightIcon={<ArrowRight className="h-4 w-4" />}
            onClick={() => router.push("/login")}
          >
            Start working
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            leftIcon={<LogIn className="h-4 w-4" />}
            onClick={() => router.push("/register")}
          >
            Create account
          </Button>
        </motion.div>
      </div>
    </section>
  );
}
