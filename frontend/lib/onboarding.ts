export const onboardingCompletionStorageKey = "omnix.onboarding.completed";

function onboardingCompletionUserStorageKey(userId?: string | null) {
  return userId ? `${onboardingCompletionStorageKey}.${userId}` : null;
}

export function readOnboardingCompleted(userId?: string | null) {
  if (typeof window === "undefined") return false;
  const storageKey = onboardingCompletionUserStorageKey(userId);
  if (!storageKey) return false;

  try {
    return window.localStorage.getItem(storageKey) === "true";
  } catch {
    return false;
  }
}

export function markOnboardingCompleted(userId?: string | null) {
  if (typeof window === "undefined") return;
  const storageKey = onboardingCompletionUserStorageKey(userId);
  if (!storageKey) return;

  try {
    window.localStorage.setItem(storageKey, "true");
  } catch {
    // Local persistence is best effort; the in-memory gate state still dismisses.
  }
}
