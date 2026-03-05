"use client";

import { useRouter } from "next/navigation";
import { ArrowRight, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function CTA() {
  const router = useRouter();

  return (
    <section className="bg-[#07090d] px-4 py-20 sm:px-6 lg:px-8">
      <div className="mx-auto flex max-w-6xl flex-col items-start justify-between gap-8 rounded-lg border border-white/10 bg-white/[0.04] p-6 sm:p-8 lg:flex-row lg:items-center">
        <div className="max-w-2xl">
          <p className="text-sm font-medium uppercase tracking-[0.18em] text-cyan-200/70">
            Ready for handoff
          </p>
          <h2 className="mt-3 text-3xl font-semibold tracking-tight text-white">
            Start with a complete UI, then connect real auth and chat APIs.
          </h2>
        </div>
        <div className="flex w-full flex-col gap-3 sm:w-auto sm:flex-row">
          <Button
            type="button"
            size="lg"
            className="w-full sm:w-auto"
            rightIcon={<ArrowRight className="h-4 w-4" />}
            onClick={() => router.push("/login")}
          >
            Get Started
          </Button>
          <Button
            type="button"
            size="lg"
            variant="secondary"
            className="w-full sm:w-auto"
            leftIcon={<UserPlus className="h-4 w-4" />}
            onClick={() => router.push("/register")}
          >
            Register
          </Button>
        </div>
      </div>
    </section>
  );
}
