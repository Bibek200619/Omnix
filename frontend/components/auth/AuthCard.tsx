"use client";

import { useEffect, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Loader2 } from "lucide-react";
import {
  AUTH_ICONS,
  AuthBrand,
  AuthDriftOrb,
  AuthIcon,
  AuthMovingGrid,
  AuthOmnixMark,
} from "@/components/auth/OmnixAuthVisuals";
import { redirectFromWindow } from "@/lib/auth-redirects";
import { useAuth } from "@/lib/auth-context";
import { cn } from "@/lib/utils";

type AuthCardProps = {
  title: string;
  description: string;
  children: ReactNode;
  mode?: "login" | "register";
};

const steps = [
  { label: "Account", icon: AUTH_ICONS.user },
  { label: "Workspace", icon: AUTH_ICONS.workspace },
  { label: "Team", icon: AUTH_ICONS.team },
  { label: "Knowledge", icon: AUTH_ICONS.upload },
  { label: "Done", icon: AUTH_ICONS.sparkle },
];

const testimonials = [
  {
    text: "We were up and running in under 10 minutes. OMNIX is exactly what our ops team needed.",
    author: "Sarah Chen",
    role: "Head of CS · Meridian Labs",
  },
  {
    text: "The workspace model just works. Private knowledge, searchable history, real team access.",
    author: "Marcus Williams",
    role: "VP Eng · Vertex Systems",
  },
  {
    text: "I was sceptical, but after the first answer from our runbooks I was completely sold.",
    author: "Priya Nair",
    role: "Ops Lead · Foundry Digital",
  },
];

const benefits = [
  "Answers grounded in your actual documents",
  "Workspace roles and sessions stay protected",
  "Live web, uploads, and RAG ready",
];

const authEase = [0.22, 1, 0.36, 1] as const;

function LeftPanel({ mode }: { mode: "login" | "register" }) {
  const [testimonialIndex, setTestimonialIndex] = useState(0);

  useEffect(() => {
    const timer = window.setInterval(
      () => setTestimonialIndex((index) => (index + 1) % testimonials.length),
      4000,
    );
    return () => window.clearInterval(timer);
  }, []);

  const testimonial = testimonials[testimonialIndex];
  const activeStep = mode === "register" ? 0 : 4;

  return (
    <aside
      className="auth-left-panel relative hidden min-h-[760px] w-[420px] flex-shrink-0 flex-col justify-between overflow-hidden px-10 py-10 lg:flex"
    >
      <AuthDriftOrb x="30%" y="25%" size={400} color="rgba(0,255,255,0.1)" />
      <AuthDriftOrb x="80%" y="65%" size={320} color="rgba(0,51,255,0.09)" />
      <AuthMovingGrid />

      <div className="relative z-10">
        <div className="mb-12">
          <AuthBrand />
        </div>

        <div className="mb-12 flex flex-col gap-3">
          {steps.map((step, index) => {
            const done = mode === "login" || index < activeStep;
            const active = index === activeStep;
            return (
              <div key={step.label} className="flex items-center gap-3">
                <div
                  className={cn(
                    "auth-step-dot flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full transition-all duration-300",
                    done ? "auth-step-dot-done" : active ? "auth-step-dot-active" : null,
                  )}
                >
                  {done ? (
                    <AuthIcon d={AUTH_ICONS.check} size={14} stroke="#00FFFF" sw={2.5} />
                  ) : (
                    <AuthIcon d={step.icon} size={14} stroke={active ? "#00FFFF" : "rgba(255,255,255,0.25)"} sw={1.8} />
                  )}
                </div>
                <span
                  className={cn(
                    "text-sm font-bold transition-colors duration-300",
                    done ? "auth-text-cyan" : active ? "auth-text-white" : "auth-text-faint",
                  )}
                >
                  {step.label}
                </span>
                {active ? (
                  <motion.div
                    initial={{ scaleX: 0 }}
                    animate={{ scaleX: 1 }}
                    className="auth-step-progress h-px flex-1"
                  />
                ) : null}
              </div>
            );
          })}
        </div>

        <div className="flex flex-col gap-3">
          {benefits.map((benefit) => (
            <div key={benefit} className="flex items-start gap-3">
              <div
                className="auth-benefit-icon mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full"
              >
                <AuthIcon d={AUTH_ICONS.check} size={9} stroke="#00FFFF" sw={2.5} />
              </div>
              <span className="auth-text-faint text-sm leading-relaxed">{benefit}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="relative z-10">
        <div className="auth-proof-card rounded-2xl p-5">
          <div className="mb-3 flex gap-0.5">
            {[...Array(5)].map((_, index) => (
              <svg key={index} width="13" height="13" viewBox="0 0 24 24" fill="currentColor" className="auth-text-cyan" aria-hidden="true">
                <path d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
            ))}
          </div>
          <AnimatePresence mode="wait">
            <motion.div
              key={testimonialIndex}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.35 }}
            >
              <p className="auth-text-quote mb-4 text-sm leading-relaxed">
                &quot;{testimonial.text}&quot;
              </p>
              <div className="flex items-center gap-3">
                <div
                  className="auth-avatar-cyan flex h-8 w-8 items-center justify-center rounded-full text-xs font-black"
                >
                  {testimonial.author.split(" ").map((part) => part[0]).join("")}
                </div>
                <div>
                  <div className="auth-text-white text-sm font-bold">{testimonial.author}</div>
                  <div className="auth-text-faint text-xs">{testimonial.role}</div>
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </aside>
  );
}

export function AuthCard({
  title,
  description,
  children,
  mode = "login",
}: AuthCardProps) {
  const router = useRouter();
  const { isConfigured, loading, session } = useAuth();

  useEffect(() => {
    if (isConfigured && !loading && session) {
      router.replace(redirectFromWindow());
    }
  }, [isConfigured, loading, router, session]);

  if (isConfigured && (loading || session)) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-[#061020] text-slate-300">
        <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-white/[0.04] px-5 py-3 text-sm shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
          <Loader2 className="h-4 w-4 animate-spin text-cyan-200" aria-hidden="true" />
          Restoring session...
        </div>
      </main>
    );
  }

  return (
    <main
      className="auth-page-shell relative flex min-h-[100dvh] items-stretch justify-center overflow-hidden text-white sm:items-center sm:px-6 sm:py-6 lg:px-8"
    >
      <div className="absolute inset-0">
        <AuthDriftOrb x="70%" y="20%" size={500} color="rgba(0,255,255,0.055)" />
        <AuthDriftOrb x="20%" y="75%" size={380} color="rgba(0,51,255,0.06)" />
        <AuthMovingGrid />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.42, ease: authEase }}
        className="relative z-10 flex w-full max-w-6xl overflow-hidden bg-[#061020]/95 shadow-[0_60px_160px_rgba(0,0,0,0.7),0_0_80px_rgba(0,255,255,0.08)] sm:rounded-[28px] sm:border sm:border-white/[0.07]"
      >
        <LeftPanel mode={mode} />

        <section className="relative flex min-h-[100dvh] flex-1 flex-col overflow-hidden sm:min-h-[680px]">
          <div className="absolute inset-0">
            <AuthDriftOrb x="76%" y="10%" size={420} color="rgba(0,255,255,0.045)" />
            <AuthMovingGrid />
          </div>

          <div className="relative z-10 flex items-center justify-between px-5 pb-2 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-6 lg:hidden">
            <AuthBrand compact />
            <div
              className="auth-mobile-icon-tile flex h-9 w-9 items-center justify-center rounded-xl"
            >
              <AuthIcon d={AUTH_ICONS.sparkle} size={17} stroke="#00FFFF" />
            </div>
          </div>

          <div className="relative z-10 flex flex-1 items-start justify-center overflow-y-auto px-4 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:items-center sm:px-8 sm:py-8 lg:px-10">
            <div className="w-full max-w-[480px]">
              <div className="mb-5 sm:mb-7">
                <div
                  className="auth-hero-mark mb-4 flex h-12 w-12 items-center justify-center rounded-2xl sm:mb-5 sm:h-14 sm:w-14"
                >
                  <AuthOmnixMark size={30} />
                </div>
                <div
                  className="auth-eyebrow mb-4 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[11px] font-black uppercase tracking-[0.14em]"
                >
                  <span className="auth-eyebrow-dot h-1.5 w-1.5 rounded-full" />
                  {mode === "register" ? "Start your workspace" : "Welcome back"}
                </div>
                <h1 className="auth-text-white mb-3 text-[1.7rem] font-black leading-tight tracking-normal sm:text-4xl">
                  {title}
                </h1>
                <p className="auth-text-muted text-sm leading-7 sm:text-base">
                  {description}
                </p>
              </div>
              {children}
            </div>
          </div>
        </section>
      </motion.div>
    </main>
  );
}
