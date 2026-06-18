export const onboardingCompletionStorageKey = "omnix.onboarding.completed";

export function readOnboardingCompleted() {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage.getItem(onboardingCompletionStorageKey) === "true";
  } catch {
    return false;
  }
}

export function markOnboardingCompleted() {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(onboardingCompletionStorageKey, "true");
  } catch {
    // Local persistence is best effort; the in-memory gate state still dismisses.
  }
}
