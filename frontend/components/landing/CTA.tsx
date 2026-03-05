"use client";

import { ArrowRight, UserPlus } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";

export function CTA() {
  const router = useRouter();

  return (
    <section className="bg-[#11110f] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-7xl flex-col gap-8 rounded-lg border border-white/10 bg-white/[0.045] p-6 sm:p-8 lg:flex-row lg:items-center lg:justify-between">
        <div className="max-w-2xl">
          <p className="text-sm font-semibold uppercase tracking-[0.18em] text-teal-200/80">Start now</p>
          <h2 className="mt-3 text-3xl font-semibold text-white">Move from mockup to backend integration.</h2>
          <p className="mt-4 text-sm leading-6 text-stone-400">
            The routes, components, and UI states are ready for Supabase sessions and RAG API calls.
          </p>
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <Button size="lg" onClick={() => router.push("/login")}>
            Get Started
            <ArrowRight className="h-5 w-5" aria-hidden="true" />
          </Button>
          <Button size="lg" variant="secondary" onClick={() => router.push("/register")}>
            <UserPlus className="h-5 w-5" aria-hidden="true" />
            Register
          </Button>
        </div>
      </div>
    </section>
  );
}
