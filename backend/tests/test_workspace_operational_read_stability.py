from __future__ import annotations

from types import SimpleNamespace

from fastapi import HTTPException
import pytest

from app.schemas.workspace_conversations import WorkspaceChannelMessageRead
from app.schemas.workspace_initiatives import WorkspaceInitiativeRead
from app.schemas.workspace_mentions import WorkspaceMentionRead
from app.schemas.workspace_tasks import WorkspaceTaskRead
from app.services import workspace_conversation_service as conversations
from app.services import workspace_initiative_service as initiatives
from app.services import workspace_mention_service as mentions
from app.services import workspace_task_service as tasks
from app.services.supabase_service import SupabaseServiceError


@pytest.mark.asyncio
async def test_workspace_operational_reads_survive_schema_drift_together(monkeypatch: pytest.MonkeyPatch) -> None:
    async def fake_access(workspace_id: str, user_id: str):
        return SimpleNamespace(role="member", workspace={"id": workspace_id})

    async def fake_profiles(user_ids: list[str]):
        return {
            "user-1": {"full_name": "Alex", "email": "alex@example.com", "avatar_label": "A"},
            "user-2": {"full_name": "Bibek", "email": "bibek@example.com", "avatar_label": "B"},
        }

    async def fake_members(workspace: dict[str, object]):
        return [{"user_id": "user-1", "role": "member", "full_name": "Alex", "avatar_label": "A"}]

    monkeypatch.setattr(conversations, "require_workspace_access", fake_access)

    async def conversation_seed_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        assert table == "workspace_channels"
        return []

    async def fail_channel_seed(table: str, payload: dict[str, object]):
        raise SupabaseServiceError("relation workspace_channels does not exist")

    async def no_seed_race(table: str, columns: str, filters: dict[str, object]):
        return None

    monkeypatch.setattr(conversations, "select_all_trusted", conversation_seed_select_all)
    monkeypatch.setattr(conversations, "insert_one_trusted", fail_channel_seed)
    monkeypatch.setattr(conversations, "select_one_trusted", no_seed_race)

    assert await conversations.list_channels(workspace_id="workspace-1", user_id="user-1") == []

    async def channel_access(**kwargs):
        return {"id": kwargs["channel_id"], "visibility": "workspace"}, SimpleNamespace(workspace={"id": "workspace-1"})

    async def message_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        if filters.get("parent_message_id") == {"is": None}:
            return [
                {
                    "id": "message-1",
                    "workspace_id": "workspace-1",
                    "channel_id": "channel-1",
                    "author_user_id": "user-1",
                    "parent_message_id": None,
                    "content": "Please review the launch task.",
                    "context_links": [{"context_type": "task", "context_id": "task-1", "label": "Launch"}],
                    "metadata": {"mentions": [{"user_id": "user-2", "label": "Bibek", "avatar_label": "B"}]},
                }
            ]
        return []

    async def fail_conversation_mentions(**kwargs):
        raise HTTPException(status_code=500, detail="Internal server error")

    monkeypatch.setattr(conversations, "_require_channel_access", channel_access)
    monkeypatch.setattr(conversations, "select_all_trusted", message_select_all)
    monkeypatch.setattr(conversations, "mention_metadata_for_sources", fail_conversation_mentions)
    monkeypatch.setattr(conversations, "list_workspace_members", fake_members)
    monkeypatch.setattr(conversations, "get_profiles", fake_profiles)

    discussion = await conversations.list_messages(
        workspace_id="workspace-1",
        channel_id="channel-1",
        user_id="user-1",
        limit=20,
        offset=0,
    )
    WorkspaceChannelMessageRead.model_validate(discussion[0])

    monkeypatch.setattr(mentions, "require_workspace_access", fake_access)
    monkeypatch.setattr(mentions, "get_profiles", fake_profiles)

    async def mention_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        return [
            {
                "id": "mention-1",
                "workspace_id": "workspace-1",
                "mentioned_user_id": "user-2",
                "mentioned_by_user_id": "user-1",
                "source_type": "task",
                "source_id": "task-1",
                "created_at": "2026-06-03T10:00:00+00:00",
                "read_at": None,
            }
        ]

    async def fail_task_source_details(workspace_id: str, source_ids: list[str]):
        raise HTTPException(status_code=500, detail="Internal server error")

    monkeypatch.setattr(mentions, "select_all_trusted", mention_select_all)
    monkeypatch.setattr(mentions, "_task_source_details", fail_task_source_details)

    inbox = await mentions.list_mentions_for_user(workspace_id="workspace-1", user_id="user-2")
    WorkspaceMentionRead.model_validate(inbox[0])
    assert await mentions.count_unread_mentions_for_user(workspace_id="workspace-1", user_id="user-2") == {
        "unread_count": 1
    }

    monkeypatch.setattr(tasks, "require_workspace_access", fake_access)
    monkeypatch.setattr(tasks, "get_profiles", fake_profiles)

    async def task_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        if table == "workspace_tasks":
            return [
                {
                    "id": "task-1",
                    "workspace_id": "workspace-1",
                    "title": "",
                    "status": "archived",
                    "created_by": "user-1",
                    "blockers": "bad",
                    "linked_context": [{"entity_type": "channel", "entity_id": "channel-1", "label": "Launch"}],
                    "activity_metadata": {"mentions": [{"user_id": "user-2", "label": "Bibek", "avatar_label": "B"}]},
                    "momentum_metadata": None,
                }
            ]
        return []

    async def fail_task_mentions(**kwargs):
        raise HTTPException(status_code=500, detail="Internal server error")

    monkeypatch.setattr(tasks, "select_all_trusted", task_select_all)
    monkeypatch.setattr(tasks, "mention_metadata_for_sources", fail_task_mentions)

    task_rows = await tasks.list_tasks(workspace_id="workspace-1", user_id="user-1")
    WorkspaceTaskRead.model_validate(task_rows[0])

    monkeypatch.setattr(initiatives, "require_workspace_access", fake_access)
    monkeypatch.setattr(initiatives, "get_profiles", fake_profiles)

    async def initiative_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        if table == "workspace_decisions":
            return []
        return [
            {
                "id": "initiative-1",
                "workspace_id": "workspace-1",
                "name": "Legacy rollout",
                "status": "completed",
                "linked_resources": None,
                "activity_metadata": None,
            }
        ]

    async def no_base_records(workspace_id: str, user_id: str):
        return [], [], []

    monkeypatch.setattr(initiatives, "select_all_trusted", initiative_select_all)
    monkeypatch.setattr(initiatives, "_base_records", no_base_records)

    initiative_rows = await initiatives.list_initiatives(workspace_id="workspace-1", user_id="user-1")
    WorkspaceInitiativeRead.model_validate(initiative_rows[0])
