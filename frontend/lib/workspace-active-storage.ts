const LEGACY_WORKSPACE_STORAGE_KEY = "omnix.activeWorkspaceId";

function workspaceStorageKey(userId?: string | null) {
  return userId ? `${LEGACY_WORKSPACE_STORAGE_KEY}.${userId}` : null;
}

export function persistActiveWorkspaceId(userId: string | null, workspaceId: string | null) {
  if (typeof window === "undefined") return;
  const storageKey = workspaceStorageKey(userId);
  window.localStorage.removeItem(LEGACY_WORKSPACE_STORAGE_KEY);
  if (!storageKey) return;
  if (workspaceId) {
    window.localStorage.setItem(storageKey, workspaceId);
  } else {
    window.localStorage.removeItem(storageKey);
  }
}

export function readStoredActiveWorkspaceId(userId: string | null) {
  if (typeof window === "undefined") return null;
  const storageKey = workspaceStorageKey(userId);
  return storageKey ? window.localStorage.getItem(storageKey) : null;
}
