import { expect, test } from "@playwright/test";
import { activityDestination, buildNotificationFeed } from "../components/notifications/notificationFeedModel";

const mention = {
  id: "mention-1", workspace_id: "workspace-1", mentioned_user_id: "user-1", mentioned_by_user_id: "user-2",
  mentioned_by_avatar_label: "U",
  source_type: "task" as const, source_id: "task-1", source_title: "Launch", source_url: "/tasks?task=task-1",
  read_at: null, created_at: "2026-08-24T10:00:00Z",
};
const activity = {
  id: "activity-1", workspace_id: "workspace-1", event_type: "decision.created", summary: "Decision recorded",
  metadata: {}, actor_avatar_label: "U", created_at: "2026-08-24T11:00:00Z",
};

test("workspace inbox merges authoritative events while retaining mention identity", () => {
  const all = buildNotificationFeed([mention], [activity], "all");
  expect(all.map((item) => item.kind)).toEqual(["activity", "mention"]);
  expect(buildNotificationFeed([mention], [activity], "mentions").map((item) => item.id)).toEqual(["mention:mention-1"]);
  expect(buildNotificationFeed([mention], [activity], "activity").map((item) => item.id)).toEqual(["activity:activity-1"]);
});

test("workspace event destinations stay domain-focused", () => {
  expect(activityDestination("decision.created")).toBe("/decisions");
  expect(activityDestination("workspace.member_removed")).toBe("/team");
  expect(activityDestination("document.processed")).toBe("/files");
  expect(activityDestination("workspace.updated")).toBe("/workspace");
});
