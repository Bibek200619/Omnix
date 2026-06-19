"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { readOnboardingCompleted } from "@/lib/onboarding";

export function OnboardingFlow() {
  const router = useRouter();

  useEffect(() => {
    if (readOnboardingCompleted()) {
      router.replace("/dashboard");
    }
  }, [router]);

  return null;
}
