import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";
import { uploadAnnouncement } from "../components/upload/UploadDropzone";

function frontendSource(path: string) {
  return readFileSync(resolve(__dirname, `../${path}`), "utf-8");
}

const alert = frontendSource("components/ui/Alert.tsx");
const errorState = frontendSource("components/ui/OmnixErrorState.tsx");
const liveRegion = frontendSource("components/ui/LiveRegion.tsx");
const header = frontendSource("components/layout/Header.tsx");
const upload = frontendSource("components/upload/UploadDropzone.tsx");
const notifications = frontendSource("components/notifications/NotificationCenterSurface.tsx");
const invites = frontendSource("components/workspace/InviteNotifications.tsx");
const chatInterface = frontendSource("components/chat/ChatInterface.tsx");
const chatStream = frontendSource("components/chat/useChatStream.ts");
const messageList = frontendSource("components/chat/MessageList.tsx");

test("shared announcements are atomic and errors use assertive semantics", () => {
  expect(liveRegion).toContain('role={politeness === "assertive" ? "alert" : "status"}');
  expect(liveRegion).toContain("aria-live={politeness}");
  expect(liveRegion).toContain('aria-atomic="true"');
  expect(alert).toContain('variant === "error" ? "assertive" : "polite"');
  expect(alert).toContain('aria-atomic={announce ? "true" : undefined}');
  expect(errorState).toContain('aria-live="assertive"');
  expect(errorState).toContain('aria-atomic="true"');
});

test("realtime and notification state changes have bounded live owners", () => {
  expect(header).toContain('<LiveRegion message={`Realtime ${realtimeStatusLabel}.`} />');
  expect(header).toContain('<Alert announce={false} variant="warning"');
  expect(notifications).toContain('Loading workspace events…');
  expect(notifications).toContain('role="status" aria-live="polite" aria-atomic="true"');
  expect(invites).toContain('title: action === "accept" ? "Invitation accepted" : "Invitation declined"');
  expect(invites).toContain('message={`New workspace invitation from ${inviteSender(invite)} to join ${inviteWorkspaceName(invite)}.`}');
  expect(invites).toContain('role="alert" aria-live="assertive" aria-atomic="true"');
});

test("upload lifecycle announcements stay stable while progress remains semantic", () => {
  const file = { name: "research.md" } as File;

  expect(uploadAnnouncement({ file, status: "uploading" })).toBe("research.md upload started.");
  expect(uploadAnnouncement({ file, status: "done", processingStatus: "queued" })).toBe(
    "research.md uploaded and queued for processing.",
  );
  expect(uploadAnnouncement({ file, status: "done", processingStatus: "processing" })).toBe(
    "research.md uploaded and is processing.",
  );
  expect(uploadAnnouncement({ file, status: "done", processingStatus: "failed" })).toBe(
    "research.md uploaded, but processing failed.",
  );
  expect(uploadAnnouncement({ file, status: "error" })).toBe("research.md upload failed.");
  expect(upload).toContain('role="progressbar"');
  expect(upload).toContain('aria-valuenow={it.progress}');
  expect(upload).toContain('aria-valuetext={`${it.progress}% uploaded`}');
});

test("loading placeholders expose text separately from decorative skeletons", () => {
  expect(messageList).toContain("Loading conversation…");
  expect(messageList).toContain('<div className="flex flex-col gap-4" aria-hidden="true">');
  expect(notifications).toContain('<div className="grid gap-2" aria-hidden="true">');
});

test("chat announces lifecycle states instead of streamed tokens", () => {
  expect(chatInterface).toContain('<LiveRegion message={chatStream.streamAnnouncement} />');
  expect(chatStream).toContain('setStreamAnnouncement("Omnix is responding.")');
  expect(chatStream).toContain('setStreamAnnouncement("Response complete.")');
  expect(chatStream).toContain('setStreamAnnouncement("Response stopped.")');
  expect(chatStream).toContain('setStreamAnnouncement("Omnix could not complete the response.")');
  expect(chatStream).not.toContain("setStreamingContent");
  expect(chatInterface).not.toContain("streamingContent");
});
