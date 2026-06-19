export const onboardingCompletionStorageKey = "omnix.onboarding.completed";

function onboardingCompletionUserStorageKey(userId?: string | null) {
  return userId ? `${onboardingCompletionStorageKey}.${userId}` : onboardingCompletionStorageKey;
}

export function readOnboardingCompleted(userId?: string | null) {
  if (typeof window === "undefined") return false;

  try {
    if (window.localStorage.getItem(onboardingCompletionUserStorageKey(userId)) === "true") {
      return true;
    }
    return window.localStorage.getItem(onboardingCompletionStorageKey) === "true";
  } catch {
    return false;
  }
}

export function markOnboardingCompleted(userId?: string | null) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(onboardingCompletionUserStorageKey(userId), "true");
  } catch {
    // Local persistence is best effort; the in-memory gate state still dismisses.
  }
}
