import type { WorkspaceMentionInboxItem } from "@/lib/workspace-types";

export const browserNotificationsPreferenceKey = "omnix.browserNotifications.enabled";

export type BrowserNotificationsPermission = NotificationPermission | "unsupported";

export function getBrowserNotificationsPermission(): BrowserNotificationsPermission {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  return Notification.permission;
}

export function readBrowserNotificationsEnabled() {
  if (typeof window === "undefined") return false;

  try {
    return window.localStorage?.getItem(browserNotificationsPreferenceKey) === "true";
  } catch {
    return false;
  }
}

export function writeBrowserNotificationsEnabled(enabled: boolean) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage?.setItem(browserNotificationsPreferenceKey, String(enabled));
  } catch {
    // Browser notification preference is optional local state.
  }
}

export async function requestBrowserNotificationsPermission(): Promise<BrowserNotificationsPermission> {
  if (typeof window === "undefined" || !("Notification" in window)) {
    return "unsupported";
  }

  const permission = await Notification.requestPermission();
  writeBrowserNotificationsEnabled(permission === "granted");
  return permission;
}

function actorLabel(item: WorkspaceMentionInboxItem) {
  return item.mentioned_by_name || item.mentioned_by_email || "Workspace member";
}

function mentionBody(item: WorkspaceMentionInboxItem) {
  if (item.source_preview) return item.source_preview;
  return `${actorLabel(item)} mentioned you in ${item.source_title}.`;
}

export function showMentionBrowserNotification(item: WorkspaceMentionInboxItem) {
  if (
    typeof window === "undefined" ||
    !readBrowserNotificationsEnabled() ||
    getBrowserNotificationsPermission() !== "granted"
  ) {
    return;
  }

  const notification = new Notification("New mention in Omnix", {
    body: mentionBody(item),
    tag: `omnix-mention-${item.id}`,
  });

  notification.onclick = () => {
    window.focus();
    window.location.assign(item.source_url);
    notification.close();
  };
}
