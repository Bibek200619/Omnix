"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import {
  ArrowRight,
  Bot,
  Check,
  Clock3,
  Database,
  FileText,
  Globe2,
  History,
  Layers3,
  LockKeyhole,
  MessageSquareText,
  Play,
  Search,
  Send,
  ShieldCheck,
  Sparkles,
  UploadCloud,
  UsersRound,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { OmnixMark } from "@/components/brand/OmnixMark";
import { cn } from "@/lib/utils";

const features: Array<{
  icon: LucideIcon;
  title: string;
  description: string;
  accent: string;
}> = [
  {
    icon: MessageSquareText,
    title: "Precision AI chat",
    description:
      "Ask complex questions across team knowledge, live web research, and conversation history with source-backed answers.",
    accent: "cyan",
  },
  {
    icon: UploadCloud,
    title: "Shared knowledge files",
    description:
      "Upload PDFs, DOCX, text, and Markdown into secure workspace libraries that every teammate can query.",
    accent: "indigo",
  },
  {
    icon: UsersRound,
    title: "Collaborative workspaces",
    description:
      "Invite teammates, manage roles, and build shared intelligence across operations, research, support, and product teams.",
    accent: "emerald",
  },
  {
    icon: Globe2,
    title: "Live web intelligence",
    description:
      "Bring current information into the same answer as local documents with hybrid web and workspace retrieval.",
    accent: "sky",
  },
  {
    icon: Database,
    title: "Semantic RAG",
    description:
      "Retrieve the right document chunks before generation, keeping answers grounded without cluttering the context window.",
    accent: "violet",
  },
  {
    icon: Clock3,
    title: "Streaming responses",
    description:
      "Get fast, readable AI output with smooth streaming, citations, and source cards that persist after reload.",
    accent: "amber",
  },
];

const metrics = [
  { value: "10k+", label: "Team queries", icon: MessageSquareText },
  { value: "98.7%", label: "Grounded accuracy", icon: ShieldCheck },
  { value: "<2s", label: "Fast first tokens", icon: Sparkles },
  { value: "24/7", label: "Workspace memory", icon: History },
  { value: "Hybrid", label: "Docs + live web", icon: Layers3 },
  { value: "Secure", label: "Authenticated access", icon: LockKeyhole },
];

const workflow = [
  {
    step: "01",
    title: "Create your workspace",
    copy: "Sign up, join a shared Omnix workspace, and keep every protected route gated by an active session.",
    icon: Workflow,
  },
  {
    step: "02",
    title: "Upload team knowledge",
    copy: "Drop in documents, let Omnix index them, and make private knowledge searchable for the whole team.",
    icon: UploadCloud,
  },
  {
    step: "03",
    title: "Search the live web",
    copy: "Use web or hybrid mode when questions need current information, news, scores, trends, or public docs.",
    icon: Globe2,
  },
  {
    step: "04",
    title: "Synthesize with sources",
    copy: "Stream polished answers that blend workspace context, web results, citations, and shared history.",
    icon: Bot,
  },
];

const retrievalModes = [
  {
    name: "Auto",
    description:
      "Omnix selects the best strategy for each question, routing between workspace knowledge, web search, or both.",
    icon: Sparkles,
    accent: "text-cyan-200",
  },
  {
    name: "Workspace",
    description:
      "Answers stay grounded in uploaded documents, workspace memory, and team conversation history.",
    icon: Database,
    accent: "text-indigo-200",
  },
  {
    name: "Web",
    description:
      "Live search brings current public information into the answer with compact source metadata.",
    icon: Globe2,
    accent: "text-emerald-200",
  },
  {
    name: "Hybrid",
    description:
      "Private knowledge and live internet context are merged into a single research-grade response.",
    icon: Layers3,
    accent: "text-amber-200",
  },
];

const accentClasses: Record<string, string> = {
  cyan: "border-cyan-300/18 bg-cyan-300/[0.06] text-cyan-200",
  indigo: "border-indigo-300/18 bg-indigo-300/[0.06] text-indigo-200",
  emerald: "border-emerald-300/18 bg-emerald-300/[0.06] text-emerald-200",
  sky: "border-sky-300/18 bg-sky-300/[0.06] text-sky-200",
  violet: "border-violet-300/18 bg-violet-300/[0.06] text-violet-200",
  amber: "border-amber-300/18 bg-amber-300/[0.06] text-amber-200",
};

function BackgroundGrid({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cn(
        "pointer-events-none absolute inset-0 overflow-hidden",
        "bg-[linear-gradient(rgba(34,211,238,0.035)_1px,transparent_1px),linear-gradient(90deg,rgba(34,211,238,0.035)_1px,transparent_1px)] bg-[size:56px_56px]",
        className,
      )}
    />
  );
}

function FadeIn({
  children,
  className,
  delay = 0,
}: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 22 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.22 }}
      transition={{ duration: 0.45, delay, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}

function BrandLockup() {
  return (
    <Link href="/" className="inline-flex items-center gap-3" aria-label="Omnix home">
      <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10">
        <OmnixMark size={27} />
      </span>
      <span className="text-sm font-black uppercase tracking-[0.18em] text-white">
        Omnix
      </span>
    </Link>
  );
}

function Pill({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/[0.07] px-3 py-1 text-[11px] font-black uppercase tracking-[0.18em] text-cyan-200">
      <span className="h-1.5 w-1.5 rounded-full bg-cyan-300 shadow-[0_0_14px_rgba(34,211,238,0.65)]" />
      {children}
    </span>
  );
}

function PrimaryCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-cyan-200/70 bg-cyan-300 px-5 text-sm font-black text-slate-950 shadow-[0_0_34px_rgba(34,211,238,0.28)] transition hover:-translate-y-0.5 hover:bg-cyan-200 hover:shadow-[0_0_46px_rgba(34,211,238,0.42)] focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      {children}
    </Link>
  );
}

function SecondaryCta({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex h-12 items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.055] px-5 text-sm font-semibold text-slate-200 transition hover:border-white/20 hover:bg-white/[0.09] hover:text-white focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-200/70 focus-visible:ring-offset-2 focus-visible:ring-offset-canvas"
    >
      {children}
    </Link>
  );
}

function Navbar() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.06] bg-[#061020]/82 px-4 backdrop-blur-2xl sm:px-6 lg:px-8">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between">
        <BrandLockup />
        <div className="hidden items-center gap-8 text-sm text-slate-400 md:flex">
          <a href="#features" className="transition hover:text-white">
            Features
          </a>
          <a href="#workflow" className="transition hover:text-white">
            How it works
          </a>
          <a href="#retrieval" className="transition hover:text-white">
            Modes
          </a>
          <a href="#security" className="transition hover:text-white">
            Security
          </a>
        </div>
        <div className="flex items-center gap-2">
          <Link
            href="/login"
            className="hidden rounded-lg px-3 py-2 text-sm font-semibold text-slate-300 transition hover:bg-white/[0.06] hover:text-white sm:inline-flex"
          >
            Sign in
          </Link>
          <Link
            href="/register"
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-cyan-200/60 bg-cyan-300 px-4 text-sm font-black text-slate-950 shadow-[0_0_24px_rgba(34,211,238,0.28)] transition hover:bg-cyan-200"
          >
            Get started
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      </nav>
    </header>
  );
}

function HeroWorkspacePreview() {
  const modes = ["Auto", "Workspace", "Web", "Hybrid"];
  const navItems: Array<{ icon: LucideIcon; label: string; active: boolean }> = [
    { icon: MessageSquareText, label: "Chat", active: true },
    { icon: FileText, label: "Files", active: false },
    { icon: History, label: "History", active: false },
    { icon: ShieldCheck, label: "Settings", active: false },
  ];

  return (
    <motion.div
      initial={{ opacity: 0, y: 38, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ duration: 0.65, delay: 0.18, ease: "easeOut" }}
      className="relative mx-auto mt-12 w-full max-w-5xl"
    >
      <div className="absolute -inset-x-6 top-10 h-44 rounded-[48px] bg-cyan-300/10 blur-3xl" aria-hidden="true" />
      <div className="relative overflow-hidden rounded-lg border border-cyan-300/15 bg-[#07111f]/95 shadow-[0_44px_140px_rgba(0,0,0,0.62),0_0_80px_rgba(34,211,238,0.08)]">
        <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.025] px-4 py-3">
          <span className="h-2.5 w-2.5 rounded-full bg-rose-300/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
          <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
          <span className="flex-1 text-center text-xs text-slate-500">
            OMNIX — Enterprise Research Workspace
          </span>
          <span className="rounded-md bg-emerald-300/10 px-2 py-1 text-[11px] font-semibold text-emerald-200">
            Synced
          </span>
        </div>
        <div className="grid min-h-[420px] lg:grid-cols-[230px_1fr]">
          <aside className="hidden border-r border-white/[0.06] bg-black/10 p-4 lg:block">
            <div className="mb-5 rounded-lg border border-cyan-300/14 bg-cyan-300/[0.05] p-3">
              <div className="flex items-center gap-3">
                <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-cyan-300/25 bg-cyan-300/10 text-sm font-black text-cyan-100">
                  D
                </span>
                <div>
                  <p className="text-sm font-bold text-white">demo</p>
                  <p className="text-xs text-slate-500">Founder · 2 members</p>
                </div>
              </div>
            </div>
            {navItems.map(({ icon: NavIcon, label, active }) => {
              return (
                <div
                  key={label}
                  className={cn(
                    "mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                    active ? "bg-cyan-300/[0.08] text-cyan-200" : "text-slate-500",
                  )}
                >
                  <NavIcon className="h-4 w-4" />
                  {label}
                </div>
              );
            })}
            <p className="mb-2 mt-6 px-1 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">
              Recent chats
            </p>
            {["Enterprise rollout", "SLA compliance", "Market research"].map((item, index) => (
              <div
                key={item}
                className={cn(
                  "mb-1 rounded-lg px-3 py-2 text-xs",
                  index === 0 ? "bg-white/[0.045] text-slate-200" : "text-slate-600",
                )}
              >
                {item}
              </div>
            ))}
          </aside>
          <section className="flex min-w-0 flex-col">
            <div className="flex flex-col gap-3 border-b border-white/[0.05] px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-bold text-white">Hybrid workspace intelligence</p>
                <p className="mt-1 text-xs text-slate-500">
                  Documents, web research, citations, and shared memory in one response.
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {modes.map((mode, index) => (
                  <span
                    key={mode}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-[11px] font-semibold",
                      index === 0
                        ? "border-cyan-300/25 bg-cyan-300/[0.12] text-cyan-200"
                        : "border-white/10 bg-white/[0.035] text-slate-500",
                    )}
                  >
                    {mode}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex-1 space-y-4 p-4 sm:p-5">
              <div className="ml-auto max-w-md rounded-lg border border-cyan-300/20 bg-cyan-300/[0.075] px-4 py-3 text-sm leading-6 text-cyan-50">
                Latest competitors in enterprise AI research, with source links.
              </div>
              <div className="max-w-xl rounded-lg border border-white/10 bg-white/[0.045] px-4 py-4 text-sm leading-6 text-slate-300">
                <div className="mb-3 flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-200">
                  <OmnixMark size={16} />
                  Omnix AI
                  <span className="rounded-full border border-cyan-300/20 px-2 py-0.5 text-[10px] normal-case tracking-normal">
                    Hybrid
                  </span>
                </div>
                <p>
                  I found three live market signals, matched them against your uploaded
                  positioning notes, and grouped the results by product motion.
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {["runbooks.pdf", "Tavily source", "workspace memory"].map((source) => (
                    <span
                      key={source}
                      className="inline-flex items-center gap-1 rounded-md border border-cyan-300/16 bg-cyan-300/[0.055] px-2 py-1 text-xs font-semibold text-cyan-200"
                    >
                      <FileText className="h-3 w-3" />
                      {source}
                    </span>
                  ))}
                </div>
              </div>
              <div className="max-w-lg rounded-lg border border-white/10 bg-white/[0.035] px-4 py-3">
                <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-emerald-200">
                  <Search className="h-3.5 w-3.5" />
                  Live web context retrieved
                </div>
                <div className="h-2 rounded-full bg-white/10" />
                <div className="mt-2 h-2 w-10/12 rounded-full bg-white/10" />
                <div className="mt-2 h-2 w-7/12 rounded-full bg-white/10" />
              </div>
            </div>
            <div className="border-t border-white/[0.06] p-4">
              <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.045] px-4 py-3">
                <span className="flex-1 text-sm text-slate-500">
                  Ask Omnix anything about your knowledge base...
                </span>
                <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-300 text-slate-950">
                  <Send className="h-4 w-4" />
                </span>
              </div>
            </div>
          </section>
        </div>
      </div>
    </motion.div>
  );
}

function Hero() {
  return (
    <section className="relative isolate overflow-hidden px-4 pb-16 pt-14 sm:px-6 lg:px-8">
      <BackgroundGrid className="opacity-70" />
      <div
        aria-hidden="true"
        className="absolute inset-x-0 top-0 h-[520px] bg-[radial-gradient(ellipse_at_50%_0%,rgba(34,211,238,0.14),rgba(0,85,255,0.06)_38%,transparent_72%)]"
      />
      <div className="relative z-10 mx-auto max-w-7xl text-center">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35 }}
        >
          <Pill>AI workspace for knowledge teams</Pill>
        </motion.div>
        <motion.h1
          initial={{ opacity: 0, y: 26 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, delay: 0.06, ease: "easeOut" }}
          className="mx-auto mt-7 max-w-5xl text-balance text-5xl font-black leading-[1.04] tracking-normal text-white sm:text-6xl lg:text-7xl"
        >
          Turn private knowledge into{" "}
          <span className="bg-gradient-to-r from-cyan-200 via-sky-300 to-blue-500 bg-clip-text text-transparent">
            precise AI answers
          </span>
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.14 }}
          className="mx-auto mt-6 max-w-2xl text-base leading-8 text-slate-400 sm:text-lg"
        >
          Omnix gives research, support, and operations teams a secure place to
          chat with uploaded documents, live web search, semantic retrieval, and
          collaborative workspace memory.
        </motion.p>
        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, delay: 0.2 }}
          className="mt-9 flex flex-col justify-center gap-3 sm:flex-row"
        >
          <PrimaryCta href="/register">
            Start working free
            <ArrowRight className="h-4 w-4" />
          </PrimaryCta>
          <SecondaryCta href="/login">
            <Play className="h-4 w-4" />
            Sign in to workspace
          </SecondaryCta>
        </motion.div>
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.45, delay: 0.28 }}
          className="mt-5 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-slate-500"
        >
          {["No credit card", "Free for small teams", "RAG + web search", "Secure sessions"].map((item) => (
            <span key={item} className="inline-flex items-center gap-1.5">
              <Check className="h-3.5 w-3.5 text-cyan-300/70" />
              {item}
            </span>
          ))}
        </motion.div>
        <HeroWorkspacePreview />
      </div>
    </section>
  );
}

function Metrics() {
  return (
    <section className="border-y border-white/[0.06] bg-[#07111d] px-4 py-10 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {metrics.map(({ value, label, icon: Icon }, index) => (
          <FadeIn key={label} delay={index * 0.025}>
            <div className="rounded-lg border border-white/[0.07] bg-white/[0.035] p-4 text-center transition hover:border-cyan-300/18 hover:bg-cyan-300/[0.04]">
              <Icon className="mx-auto h-5 w-5 text-cyan-200/75" />
              <p className="mt-3 text-xl font-black text-white">{value}</p>
              <p className="mt-1 text-xs text-slate-500">{label}</p>
            </div>
          </FadeIn>
        ))}
      </div>
    </section>
  );
}

function SectionIntro({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: React.ReactNode;
  copy?: string;
}) {
  return (
    <FadeIn className="mx-auto mb-12 max-w-3xl text-center">
      <Pill>{eyebrow}</Pill>
      <h2 className="mt-5 text-balance text-3xl font-black tracking-normal text-white sm:text-4xl lg:text-5xl">
        {title}
      </h2>
      {copy ? (
        <p className="mx-auto mt-4 max-w-2xl text-base leading-7 text-slate-400">
          {copy}
        </p>
      ) : null}
    </FadeIn>
  );
}

function Features() {
  return (
    <section id="features" className="relative overflow-hidden bg-[#061020] px-4 py-20 sm:px-6 lg:px-8">
      <BackgroundGrid className="opacity-40" />
      <div className="relative z-10 mx-auto max-w-7xl">
        <SectionIntro
          eyebrow="Features"
          title="Everything your team needs"
          copy="Omnix is built for teams that need answers they can trust: fast, secure, current, and grounded in their own knowledge."
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {features.map(({ icon: Icon, title, description, accent }, index) => (
            <FadeIn key={title} delay={index * 0.035}>
              <article className="group h-full rounded-lg border border-white/[0.075] bg-white/[0.035] p-6 transition duration-200 hover:-translate-y-1 hover:border-cyan-300/20 hover:bg-white/[0.055]">
                <div
                  className={cn(
                    "mb-5 flex h-11 w-11 items-center justify-center rounded-lg border",
                    accentClasses[accent],
                  )}
                >
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-base font-black text-white">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-500 group-hover:text-slate-400">
                  {description}
                </p>
              </article>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function ProductPreview() {
  const tabs = [
    { label: "AI Chat", icon: MessageSquareText },
    { label: "Files", icon: FileText },
    { label: "History", icon: History },
    { label: "Settings", icon: ShieldCheck },
  ];

  return (
    <section className="relative overflow-hidden bg-[#07111d] px-4 py-20 sm:px-6 lg:px-8">
      <BackgroundGrid className="opacity-35" />
      <div className="relative z-10 mx-auto max-w-7xl">
        <SectionIntro
          eyebrow="Inside the app"
          title={
            <>
              A workspace built for{" "}
              <span className="bg-gradient-to-r from-cyan-200 to-blue-500 bg-clip-text text-transparent">
                real operations
              </span>
            </>
          }
          copy="The interface stays calm and focused while the intelligence layer handles documents, web search, history, and team context."
        />
        <FadeIn>
          <div className="mx-auto mb-6 flex max-w-fit flex-wrap justify-center gap-1 rounded-lg border border-white/10 bg-white/[0.035] p-1.5">
            {tabs.map(({ label, icon: Icon }, index) => (
              <button
                key={label}
                type="button"
                className={cn(
                  "inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm font-bold transition",
                  index === 0
                    ? "border-cyan-300/25 bg-cyan-300/[0.12] text-cyan-200"
                    : "border-transparent text-slate-500 hover:text-slate-300",
                )}
              >
                <Icon className="h-4 w-4" />
                {label}
              </button>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border border-cyan-300/12 bg-[#06121f] shadow-[0_36px_120px_rgba(0,0,0,0.48)]">
            <div className="flex items-center gap-2 border-b border-white/[0.06] bg-white/[0.025] px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-300/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-300/80" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-300/80" />
              <span className="flex-1 text-center text-xs text-slate-500">OMNIX — AI Chat</span>
            </div>
            <div className="grid min-h-[420px] lg:grid-cols-[230px_1fr]">
              <aside className="hidden border-r border-white/[0.06] p-5 lg:block">
                <p className="mb-4 text-[11px] font-black uppercase tracking-[0.16em] text-slate-600">
                  Knowledge base
                </p>
                {["Runbooks", "Policies", "Documentation", "Compliance", "Analytics"].map((item, index) => (
                  <div
                    key={item}
                    className={cn(
                      "mb-1 flex items-center gap-3 rounded-lg px-3 py-2 text-sm",
                      index === 0 ? "bg-cyan-300/[0.08] text-cyan-200" : "text-slate-500",
                    )}
                  >
                    <FileText className="h-4 w-4" />
                    {item}
                  </div>
                ))}
              </aside>
              <div className="flex flex-col gap-4 p-5">
                <div className="ml-auto max-w-sm rounded-lg border border-cyan-300/18 bg-cyan-300/[0.07] px-4 py-3 text-sm text-cyan-50">
                  What are our enterprise SLA commitments?
                </div>
                <div className="max-w-xl rounded-lg border border-white/10 bg-white/[0.04] px-4 py-4 text-sm leading-6 text-slate-300">
                  <div className="mb-2 flex items-center gap-2 text-xs font-black uppercase tracking-[0.12em] text-cyan-200">
                    <OmnixMark size={16} />
                    Omnix AI
                  </div>
                  Based on `enterprise-sla.pdf`: 99.9% uptime, P1 response within
                  4 hours, and automatic SLA credits for eligible outages.
                  <div className="mt-3 inline-flex items-center gap-1 rounded-md border border-cyan-300/16 bg-cyan-300/[0.055] px-2 py-1 text-xs font-semibold text-cyan-200">
                    <FileText className="h-3 w-3" />
                    enterprise-sla.pdf
                  </div>
                </div>
                <div className="grid gap-3 md:grid-cols-3">
                  {["Source cards", "Team roles", "Streaming UI"].map((item) => (
                    <div key={item} className="rounded-lg border border-white/10 bg-white/[0.035] p-4">
                      <p className="text-sm font-bold text-white">{item}</p>
                      <div className="mt-3 h-2 rounded-full bg-white/10" />
                      <div className="mt-2 h-2 w-8/12 rounded-full bg-cyan-300/15" />
                    </div>
                  ))}
                </div>
                <div className="mt-auto flex items-center gap-3 rounded-lg border border-white/10 bg-white/[0.04] px-4 py-3">
                  <span className="text-sm text-slate-500">Ask Omnix anything...</span>
                  <span className="ml-auto flex h-9 w-9 items-center justify-center rounded-lg bg-cyan-300 text-slate-950">
                    <Send className="h-4 w-4" />
                  </span>
                </div>
              </div>
            </div>
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function WorkflowSection() {
  return (
    <section id="workflow" className="relative overflow-hidden bg-[#061020] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto max-w-7xl">
        <SectionIntro
          eyebrow="How it works"
          title={
            <>
              Up and running in{" "}
              <span className="bg-gradient-to-r from-cyan-200 to-blue-500 bg-clip-text text-transparent">
                under 5 minutes
              </span>
            </>
          }
          copy="No complex setup. Omnix is useful from day one and grows into your shared research operating system."
        />
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {workflow.map(({ step, title, copy, icon: Icon }, index) => (
            <FadeIn key={title} delay={index * 0.04}>
              <article className="h-full rounded-lg border border-white/[0.075] bg-white/[0.035] p-5">
                <div className="mb-5 flex items-center justify-between">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-cyan-300/18 bg-cyan-300/[0.06] text-cyan-200">
                    <Icon className="h-5 w-5" />
                  </div>
                  <span className="text-xs font-black text-cyan-300/55">{step}</span>
                </div>
                <h3 className="text-base font-black text-white">{title}</h3>
                <p className="mt-3 text-sm leading-6 text-slate-500">{copy}</p>
              </article>
            </FadeIn>
          ))}
        </div>
      </div>
    </section>
  );
}

function RetrievalSection() {
  return (
    <section id="retrieval" className="relative overflow-hidden bg-[#07111d] px-4 py-20 sm:px-6 lg:px-8">
      <BackgroundGrid className="opacity-30" />
      <div className="relative z-10 mx-auto grid max-w-7xl gap-10 lg:grid-cols-[0.8fr_1.2fr] lg:items-center">
        <FadeIn>
          <Pill>Intelligent retrieval</Pill>
          <h2 className="mt-5 text-balance text-3xl font-black tracking-normal text-white sm:text-4xl lg:text-5xl">
            Context-aware AI that knows when to use{" "}
            <span className="bg-gradient-to-r from-cyan-200 to-blue-500 bg-clip-text text-transparent">
              web, docs, or both
            </span>
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-400">
            Omnix can answer from uploaded workspace knowledge, current internet
            research, or a hybrid of both without forcing users to understand the
            underlying retrieval pipeline.
          </p>
        </FadeIn>
        <FadeIn delay={0.08}>
          <div className="grid gap-3 sm:grid-cols-2">
            {retrievalModes.map(({ name, description, icon: Icon, accent }, index) => (
              <article
                key={name}
                className={cn(
                  "rounded-lg border bg-white/[0.035] p-5",
                  index === 0 ? "border-cyan-300/20" : "border-white/[0.075]",
                )}
              >
                <div className="mb-4 flex items-center gap-3">
                  <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-white/10 bg-white/[0.045]">
                    <Icon className={cn("h-5 w-5", accent)} />
                  </div>
                  <p className="font-black text-white">{name}</p>
                </div>
                <p className="text-sm leading-6 text-slate-500">{description}</p>
              </article>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function SecuritySection() {
  return (
    <section id="security" className="relative overflow-hidden bg-[#061020] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto grid max-w-7xl gap-10 lg:grid-cols-[1fr_0.9fr] lg:items-center">
        <FadeIn>
          <div className="grid gap-3 sm:grid-cols-2">
            {["Authenticated sessions", "Role-based workspaces", "Private files", "Source metadata"].map((item, index) => (
              <div key={item} className="rounded-lg border border-white/[0.075] bg-white/[0.035] p-5">
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-300/18 bg-emerald-300/[0.06] text-emerald-200">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <p className="font-black text-white">{item}</p>
                <p className="mt-2 text-sm leading-6 text-slate-500">
                  {index === 0
                    ? "Protected screens depend on a valid session before workspace data loads."
                    : "Designed to keep collaboration scoped, auditable, and tied to the authenticated user."}
                </p>
              </div>
            ))}
          </div>
        </FadeIn>
        <FadeIn delay={0.08}>
          <Pill>Enterprise security</Pill>
          <h2 className="mt-5 text-balance text-3xl font-black tracking-normal text-white sm:text-4xl lg:text-5xl">
            Your knowledge stays{" "}
            <span className="bg-gradient-to-r from-cyan-200 to-blue-500 bg-clip-text text-transparent">
              yours
            </span>
          </h2>
          <p className="mt-5 text-base leading-8 text-slate-400">
            The redesign keeps Omnix’s existing auth architecture intact: server
            APIs stay behind bearer tokens, protected routes stay guarded, and
            workspace data remains bound to the active session.
          </p>
          <div className="mt-6 grid gap-3">
            {["Identity-first app shell", "Backend API keys stay server-side", "Workspace-aware API headers", "Session persistence preserved"].map((item) => (
              <div key={item} className="flex items-center gap-3 text-sm text-slate-300">
                <span className="flex h-5 w-5 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] text-cyan-200">
                  <Check className="h-3 w-3" />
                </span>
                {item}
              </div>
            ))}
          </div>
        </FadeIn>
      </div>
    </section>
  );
}

function FinalCta() {
  return (
    <section className="relative overflow-hidden bg-[#07111d] px-4 py-20 sm:px-6 lg:px-8">
      <BackgroundGrid className="opacity-35" />
      <FadeIn className="relative z-10 mx-auto max-w-5xl overflow-hidden rounded-lg border border-cyan-300/18 bg-[#061322] px-6 py-14 text-center shadow-[0_34px_120px_rgba(0,0,0,0.48)] sm:px-10 sm:py-16">
        <div
          aria-hidden="true"
          className="absolute inset-x-0 top-0 h-32 bg-[radial-gradient(ellipse_at_50%_0%,rgba(34,211,238,0.16),transparent_70%)]"
        />
        <div className="relative">
          <Pill>Start with Omnix</Pill>
          <h2 className="mx-auto mt-5 max-w-3xl text-balance text-4xl font-black tracking-normal text-white sm:text-5xl">
            Bring a secure AI research workspace to your team today.
          </h2>
          <p className="mx-auto mt-5 max-w-2xl text-base leading-8 text-slate-400">
            Sign in to continue an existing workspace, or create an account and
            start building collaborative intelligence in minutes.
          </p>
          <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
            <PrimaryCta href="/register">
              Get started
              <ArrowRight className="h-4 w-4" />
            </PrimaryCta>
            <SecondaryCta href="/login">Sign in</SecondaryCta>
          </div>
        </div>
      </FadeIn>
    </section>
  );
}

function Footer() {
  return (
    <footer className="border-t border-white/[0.06] bg-[#061020] px-4 py-8 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
        <BrandLockup />
        <div className="flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/login" className="transition hover:text-white">
            Login
          </Link>
          <Link href="/register" className="transition hover:text-white">
            Register
          </Link>
          <Link href="/settings/terms" className="transition hover:text-white">
            Terms
          </Link>
        </div>
      </div>
    </footer>
  );
}

export function LandingExperience() {
  return (
    <main className="min-h-screen bg-[#061020] text-white">
      <Navbar />
      <Hero />
      <Metrics />
      <Features />
      <ProductPreview />
      <WorkflowSection />
      <RetrievalSection />
      <SecuritySection />
      <FinalCta />
      <Footer />
    </main>
  );
}
