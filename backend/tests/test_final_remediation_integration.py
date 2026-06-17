from __future__ import annotations

import asyncio
import json
import time
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi import HTTPException
from starlette.responses import JSONResponse

from app.health import router as health_router
from app.routers import messages, upload, workspaces
from app.schemas.chat import ChatRequest, WorkspaceCreate, WorkspaceInviteCreate
from app.services import chat_service
from app.services.chat_service import ModelServiceError, OllamaChatService
from app.services.workspace_service import WorkspaceAccess


class FakeUploadFile:
    def __init__(self, filename: str, content_type: str, data: bytes) -> None:
        self.filename = filename
        self.content_type = content_type
        self._data = data

    async def read(self) -> bytes:
        return self._data


class MemoryRedis:
    def __init__(self) -> None:
        self.store: dict[str, str] = {}
        self.counts: dict[str, int] = {}
        self.expirations: list[tuple[str, int]] = []

    async def get(self, key: str) -> str | None:
        return self.store.get(key)

    async def setex(self, key: str, ttl: int, value: str) -> None:
        self.store[key] = value
        self.expirations.append((key, ttl))

    async def delete(self, key: str) -> None:
        self.store.pop(key, None)

    async def incr(self, key: str) -> int:
        self.counts[key] = self.counts.get(key, 0) + 1
        return self.counts[key]

    async def expire(self, key: str, ttl: int) -> None:
        self.expirations.append((key, ttl))


def _request(workspace_id: str | None = None) -> SimpleNamespace:
    headers = {"X-Omnix-Workspace": workspace_id} if workspace_id else {}
    return SimpleNamespace(headers=headers)


def _workspace_access(workspace: dict[str, Any], role: str = "founder") -> WorkspaceAccess:
    return WorkspaceAccess(workspace=workspace, role=role)


@pytest.mark.asyncio
async def test_new_workspace_invite_upload_and_ai_response_reference_document(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user = {"sub": "user-1", "email": "founder@example.com", "user_metadata": {"full_name": "Founder"}}
    workspace = {
        "id": "workspace-1",
        "user_id": "user-1",
        "name": "Launch",
        "workspace_type": "super_workspace",
        "workspace_focus": "strategy",
        "ai_specialization": "strategy",
        "is_global": False,
    }
    activity: list[dict[str, Any]] = []
    enqueued_jobs: list[dict[str, Any]] = []

    async def fake_create_workspace_for_user(**kwargs: Any) -> dict[str, Any]:
        assert kwargs["user_id"] == "user-1"
        return {**workspace, "description": kwargs.get("description")}

    async def fake_workspace_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        assert (workspace_id, user_id) == ("workspace-1", "user-1")
        return _workspace_access(workspace)

    async def fake_workspace_management_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        return await fake_workspace_access(workspace_id, user_id)

    async def fake_members(_workspace: dict[str, Any]) -> list[dict[str, Any]]:
        return [{"user_id": "user-1", "role": "founder", "email": "founder@example.com"}]

    async def fake_activity(**kwargs: Any) -> dict[str, Any]:
        activity.append(kwargs)
        return kwargs

    async def fake_existing_invite(*args: Any, **kwargs: Any) -> None:
        return None

    async def fake_insert_invite(**kwargs: Any) -> dict[str, Any]:
        return {
            "id": "invite-1",
            "invite_id": "invite-1",
            "workspace_id": kwargs["workspace_id"],
            "email": kwargs["email"],
            "role": kwargs["role"],
            "status": "pending",
            "invited_by": kwargs["inviter_user_id"],
            "created_at": kwargs["timestamp"],
            "updated_at": kwargs["timestamp"],
        }

    async def fake_hydrate_invites(invites: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return invites

    async def fake_send_invite_email(**kwargs: Any) -> SimpleNamespace:
        assert kwargs["to_email"] == "teammate@example.com"
        return SimpleNamespace(status="skipped", provider_id=None)

    monkeypatch.setattr(workspaces, "create_workspace_for_user", fake_create_workspace_for_user)
    monkeypatch.setattr(workspaces, "require_workspace_access", fake_workspace_access)
    monkeypatch.setattr(workspaces, "require_workspace_management_access", fake_workspace_management_access)
    monkeypatch.setattr(workspaces, "list_workspace_members", fake_members)
    monkeypatch.setattr(workspaces, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(workspaces, "select_one_trusted", fake_existing_invite)
    monkeypatch.setattr(workspaces, "_insert_workspace_invite", fake_insert_invite)
    monkeypatch.setattr(workspaces, "hydrate_invites", fake_hydrate_invites)
    monkeypatch.setattr(workspaces, "send_workspace_invite_email", fake_send_invite_email)

    created_workspace = await workspaces.create_workspace(
        WorkspaceCreate(name="Launch", workspace_focus="strategy"),
        current_user=user,
    )
    invite = await workspaces.invite_workspace_member(
        "workspace-1",
        WorkspaceInviteCreate(email="teammate@example.com", role="member"),
        current_user=user,
    )

    assert created_workspace["id"] == "workspace-1"
    assert invite["email"] == "teammate@example.com"

    stored_files: dict[str, dict[str, Any]] = {}

    async def fake_find_duplicate(content_hash: str, user_id: str, workspace_id: str | None):
        for file_row in stored_files.values():
            if file_row["content_hash"] == content_hash and file_row.get("workspace_id") == workspace_id:
                return file_row
        return None

    async def fake_store_upload_bytes(**kwargs: Any) -> upload.StoredUpload:
        return upload.StoredUpload(storage_path="user-1/launch.pdf", storage_backend="supabase")

    async def fake_insert_file_row(payload: dict[str, Any], user_id: str) -> dict[str, Any]:
        row = {"id": "file-1", "user_id": user_id, **payload}
        stored_files[row["id"]] = row
        return row

    async def fake_enqueue_job(payload: dict[str, Any]) -> str:
        enqueued_jobs.append(payload)
        return "job-1"

    from app.jobs import queue

    monkeypatch.setattr(upload, "require_workspace_access", fake_workspace_access)
    monkeypatch.setattr(upload, "_find_duplicate_file", fake_find_duplicate)
    monkeypatch.setattr(upload, "_store_upload_bytes", fake_store_upload_bytes)
    monkeypatch.setattr(upload, "_insert_file_row", fake_insert_file_row)
    monkeypatch.setattr(upload, "log_workspace_activity", fake_activity)
    monkeypatch.setattr(queue, "enqueue_job", fake_enqueue_job)

    file_bytes = b"%PDF-1.7\nLaunch plan source text"
    uploaded = await upload.upload_file(
        request=_request("workspace-1"),
        file=FakeUploadFile("launch.pdf", "application/pdf", file_bytes),
        conversation_id=None,
        current_user=user,
    )
    deduped = await upload.upload_file(
        request=_request("workspace-1"),
        file=FakeUploadFile("launch.pdf", "application/pdf", file_bytes),
        conversation_id=None,
        current_user=user,
    )

    assert uploaded["id"] == "file-1"
    assert uploaded["storage_backend"] == "supabase"
    assert enqueued_jobs == [{"type": "ingest_file", "file_id": "file-1", "user_id": "user-1", "workspace_id": "workspace-1"}]
    assert deduped["status"] == "deduplicated"
    assert deduped["file_id"] == "file-1"

    inserted_messages: list[dict[str, Any]] = []

    async def fake_rate_limit(user_id: str) -> None:
        assert user_id == "user-1"

    async def fake_active_workspace_access(request: Any, user_id: str) -> WorkspaceAccess:
        assert request.headers["X-Omnix-Workspace"] == "workspace-1"
        return _workspace_access(workspace)

    async def fake_insert_one(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        assert table == "conversations"
        return {"id": "conversation-1", **payload}

    async def fake_insert_many(table: str, payloads: list[dict[str, Any]]) -> list[dict[str, Any]]:
        assert table == "messages"
        rows = [
            {"id": "user-message-1", **payloads[0]},
            {"id": "assistant-message-1", **payloads[1]},
        ]
        inserted_messages.extend(rows)
        return rows

    async def fake_attach_files(attachment_ids: list[str], **kwargs: Any) -> None:
        assert attachment_ids == ["file-1"]
        assert kwargs["workspace_id"] == "workspace-1"

    async def fake_intelligence(workspace_id: str | None, user_id: str) -> dict[str, Any]:
        return {
            "workspace_id": workspace_id,
            "workspace_name": "Launch",
            "workspace_focus": "strategy",
            "ai_specialization": "strategy",
            "source_count": 1,
        }

    async def fake_retrieve_context(*args: Any, **kwargs: Any):
        return (
            "DOCUMENT CONTEXT:\nLaunch plan source text",
            [{"label": "S1", "type": "document", "file_id": "file-1", "title": "launch.pdf"}],
            {"strategy": "uploaded_document", "retrieved_chunks_count": 1, "diagnostics": {}},
        )

    async def fake_persist_payload(**kwargs: Any) -> None:
        return None

    async def fake_call_llm(prompt: str, **kwargs: Any) -> str:
        assert "Launch plan source text" in prompt
        return "The launch plan is referenced from source S1."

    async def fake_update_assistant(**kwargs: Any) -> dict[str, Any]:
        return {
            "id": kwargs["assistant_message_id"],
            "conversation_id": "conversation-1",
            "user_id": "user-1",
            "role": "assistant",
            "content": kwargs["content"],
            "status": kwargs["status_value"],
            "payload": {"sources": kwargs["sources"], "mode": kwargs["search_mode"]},
        }

    async def fake_touch_conversation(*args: Any, **kwargs: Any) -> None:
        return None

    async def fake_hydrate_conversation_history(
        conversations: list[dict[str, Any]],
        user_id: str,
        workspace_id: str | None = None,
    ) -> list[dict[str, Any]]:
        return [
            {
                **conversations[0],
                "preview": "The launch plan is referenced from source S1.",
                "latest_message_role": "assistant",
                "latest_message_at": conversations[0].get("updated_at"),
            }
        ]

    monkeypatch.setattr(messages, "_check_rate_limit", fake_rate_limit)
    monkeypatch.setattr(messages, "require_active_workspace_access", fake_active_workspace_access)
    monkeypatch.setattr(messages, "insert_one", fake_insert_one)
    monkeypatch.setattr(messages, "insert_many", fake_insert_many)
    monkeypatch.setattr(messages, "_attach_files_to_conversation", fake_attach_files)
    monkeypatch.setattr(messages, "_load_workspace_intelligence_for_chat", fake_intelligence)
    monkeypatch.setattr(messages, "_retrieve_prompt_context", fake_retrieve_context)
    monkeypatch.setattr(messages, "_persist_assistant_payload", fake_persist_payload)
    monkeypatch.setattr(messages, "call_llm", fake_call_llm)
    monkeypatch.setattr(messages, "_update_assistant_message", fake_update_assistant)
    monkeypatch.setattr(messages, "_touch_conversation", fake_touch_conversation)
    monkeypatch.setattr(messages, "hydrate_conversation_history", fake_hydrate_conversation_history)
    monkeypatch.setattr(messages, "log_workspace_activity", fake_activity)

    chat_response = await messages.chat(
        request=_request("workspace-1"),
        payload=ChatRequest(message="Summarize the launch PDF", attachment_ids=["file-1"], search_mode="workspace"),
        current_user=user,
    )

    assert chat_response.conversation_id == "conversation-1"
    assert chat_response.sources[0]["file_id"] == "file-1"
    assert "source S1" in chat_response.response
    assert {event["event_type"] for event in activity} >= {
        "workspace.created",
        "workspace.invite_created",
        "workspace.source_uploaded",
        "workspace.ai_response_generated",
    }
    assert [row["role"] for row in inserted_messages] == ["user", "assistant"]


@pytest.mark.asyncio
async def test_operational_task_decision_initiative_flow_surfaces_momentum(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import workspace_decision_service as decisions
    from app.services import workspace_initiative_service as initiatives
    from app.services import workspace_task_service as tasks

    workspace = {"id": "workspace-1", "user_id": "user-1", "name": "Launch", "workspace_type": "super_workspace"}
    task_rows: dict[str, dict[str, Any]] = {}
    decision_rows: dict[str, dict[str, Any]] = {}
    initiative_rows: dict[str, dict[str, Any]] = {}
    decision_task_links: list[dict[str, Any]] = []

    async def fake_access(workspace_id: str, user_id: str) -> WorkspaceAccess:
        assert (workspace_id, user_id) == ("workspace-1", "user-1")
        return _workspace_access(workspace)

    async def fake_mentions(**kwargs: Any) -> list[dict[str, Any]]:
        return []

    async def fake_mentions_by_source(**kwargs: Any) -> dict[str, list[dict[str, Any]]]:
        return {}

    async def fake_profiles(user_ids: list[str]) -> dict[str, dict[str, Any]]:
        return {"user-1": {"email": "founder@example.com", "full_name": "Founder", "avatar_label": "F"}}

    async def fake_log(**kwargs: Any) -> None:
        return None

    async def fake_insert(table: str, payload: dict[str, Any]) -> dict[str, Any]:
        if table == "workspace_tasks":
            row = {"id": "task-1", "created_at": payload.get("updated_at"), **payload}
            task_rows[row["id"]] = row
            return row
        if table == "workspace_decisions":
            row = {"id": "decision-1", "created_at": payload.get("updated_at"), **payload}
            decision_rows[row["id"]] = row
            return row
        if table == "workspace_initiatives":
            row = {"id": "initiative-1", "created_at": payload.get("updated_at"), **payload}
            initiative_rows[row["id"]] = row
            return row
        if table == "workspace_decision_tasks":
            decision_task_links.append(payload)
            return payload
        if table == "workspace_operational_timeline":
            return {"id": "timeline-1", **payload}
        raise AssertionError(f"unexpected insert table {table}")

    async def fake_select_one(table: str, columns: str, filters: dict[str, Any]):
        if table == "workspace_initiatives":
            return initiative_rows.get(str(filters.get("id")))
        if table == "workspace_tasks":
            return task_rows.get(str(filters.get("id")))
        if table == "workspace_decisions":
            return decision_rows.get(str(filters.get("id")))
        return None

    async def fake_select_all(table: str, columns: str, filters: dict[str, Any] | None = None, **kwargs: Any):
        if table == "workspace_decision_tasks":
            return [
                link
                for link in decision_task_links
                if link.get("workspace_id") == (filters or {}).get("workspace_id")
            ]
        if table == "workspace_tasks":
            task_ids = set()
            if filters:
                raw_task_id = filters.get("id")
                if isinstance(raw_task_id, list):
                    task_ids.update(str(item) for item in raw_task_id)
                elif raw_task_id:
                    task_ids.add(str(raw_task_id))
            return [row for row in task_rows.values() if not task_ids or row["id"] in task_ids]
        if table == "workspace_decisions":
            task_ids = set()
            decision_ids = set()
            if filters:
                raw_task_id = filters.get("task_id")
                raw_decision_id = filters.get("id")
                if isinstance(raw_task_id, list):
                    task_ids.update(str(item) for item in raw_task_id)
                elif raw_task_id:
                    task_ids.add(str(raw_task_id))
                if isinstance(raw_decision_id, list):
                    decision_ids.update(str(item) for item in raw_decision_id)
                elif raw_decision_id:
                    decision_ids.add(str(raw_decision_id))
            if filters and filters.get("initiative_id"):
                return [
                    row
                    for row in decision_rows.values()
                    if row.get("initiative_id") == filters["initiative_id"]
                ]
            if task_ids:
                linked_decision_ids = {
                    str(link["decision_id"])
                    for link in decision_task_links
                    if str(link.get("task_id")) in task_ids
                }
                return [row for row in decision_rows.values() if row["id"] in linked_decision_ids]
            if decision_ids:
                return [row for row in decision_rows.values() if row["id"] in decision_ids]
            return list(decision_rows.values())
        if table == "workspace_initiative_channels":
            return []
        return []

    async def fake_list_tasks(**kwargs: Any) -> dict[str, Any]:
        return {"items": list(task_rows.values()), "next_cursor": None, "has_more": False}

    async def fake_list_channels(**kwargs: Any) -> list[dict[str, Any]]:
        return []

    async def fake_members(_workspace: dict[str, Any]) -> list[dict[str, Any]]:
        return [{"user_id": "user-1", "role": "founder"}]

    for module in (tasks, decisions, initiatives):
        monkeypatch.setattr(module, "require_workspace_access", fake_access)
        monkeypatch.setattr(module, "insert_one_trusted", fake_insert)
        monkeypatch.setattr(module, "select_one_trusted", fake_select_one)
        monkeypatch.setattr(module, "select_all_trusted", fake_select_all)
        monkeypatch.setattr(module, "log_workspace_activity", fake_log)
        monkeypatch.setattr(module, "get_profiles", fake_profiles)

    monkeypatch.setattr(tasks, "prepare_mentions_for_workspace", fake_mentions)
    monkeypatch.setattr(tasks, "sync_mentions_for_source", fake_log)
    monkeypatch.setattr(tasks, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(decisions, "prepare_mentions_for_workspace", fake_mentions)
    monkeypatch.setattr(decisions, "sync_mentions_for_source", fake_log)
    monkeypatch.setattr(decisions, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(initiatives, "list_tasks", fake_list_tasks)
    monkeypatch.setattr(initiatives, "list_channels", fake_list_channels)
    monkeypatch.setattr(initiatives, "list_workspace_members", fake_members)

    initiative = await initiatives.create_initiative(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Launch readiness", "status": "active"},
    )
    task = await tasks.create_task(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Verify launch plan", "status": "active", "initiative_id": initiative["id"]},
    )
    decision = await decisions.create_decision(
        workspace_id="workspace-1",
        user_id="user-1",
        payload={"title": "Ship launch plan", "status": "accepted"},
    )
    linked_decision = await decisions.link_task_to_decision(
        workspace_id="workspace-1",
        decision_id=decision["id"],
        task_id=task["id"],
        user_id="user-1",
    )
    initiative_with_momentum = await initiatives.get_initiative(
        workspace_id="workspace-1",
        initiative_id=initiative["id"],
        user_id="user-1",
    )

    assert linked_decision["linked_tasks"][0]["id"] == "task-1"
    assert initiative_with_momentum["linked_tasks"][0]["id"] == "task-1"
    assert initiative_with_momentum["momentum"]["health"] == "active_movement"


@pytest.mark.asyncio
async def test_cross_workspace_search_health_and_rate_limit_contracts(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import workspace_search_service as search_service

    captured_filters: list[dict[str, Any]] = []

    async def fake_resolve_workspace_ids(workspace_id: str, user_id: str, scope: str) -> list[str]:
        assert (workspace_id, user_id, scope) == ("workspace-1", "user-1", "organization")
        return ["workspace-1", "workspace-2"]

    async def fake_conversations(workspace_id: str | list[str], *args: Any, **kwargs: Any) -> list[dict[str, Any]]:
        captured_filters.append({"table": "conversations", "workspace_id": workspace_id})
        return []

    async def fake_search_table_fields(**kwargs: Any) -> list[dict[str, Any]]:
        captured_filters.append({"table": kwargs["table"], "workspace_id": kwargs["workspace_id"]})
        if kwargs["table"] == "workspace_tasks":
            return [{"id": "task-1", "workspace_id": "workspace-2", "title": "Launch task", "description": ""}]
        return []

    monkeypatch.setattr(search_service, "_resolve_search_workspace_ids", fake_resolve_workspace_ids)
    monkeypatch.setattr(search_service, "_search_conversations", fake_conversations)
    monkeypatch.setattr(search_service, "_search_table_fields", fake_search_table_fields)

    search = await search_service.search_workspace(
        workspace_id="workspace-1",
        user_id="user-1",
        query="launch",
        scope="organization",
    )

    assert search["tasks"][0]["workspace_id"] == "workspace-2"
    assert {tuple(item["workspace_id"]) for item in captured_filters} == {("workspace-1", "workspace-2")}

    async def fake_run_all_checks() -> dict[str, dict[str, str]]:
        return {
            "supabase": {"status": "healthy"},
            "workspace_schema": {"status": "healthy"},
            "vector_store": {"status": "healthy"},
            "redis": {"status": "healthy"},
            "ollama": {"status": "degraded"},
            "ingestion_worker": {"status": "no_worker"},
        }

    monkeypatch.setattr(health_router, "run_all_checks", fake_run_all_checks)
    readiness = await health_router.readiness_check()

    assert readiness["status"] == "ready"
    assert readiness["checks"]["workspace_schema"]["status"] == "healthy"

    redis = MemoryRedis()
    monkeypatch.setenv("OMNIX_RATE_LIMIT_RPM", "2")
    monkeypatch.setattr(messages, "get_redis", lambda: redis)

    await messages._check_rate_limit("user-1")
    await messages._check_rate_limit("user-1")
    with pytest.raises(HTTPException) as exc_info:
        await messages._check_rate_limit("user-1")
    assert exc_info.value.status_code == 429


@pytest.mark.asyncio
async def test_ollama_open_circuit_fails_ten_concurrent_requests_fast(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class UnexpectedHttpClient:
        def __init__(self, **kwargs: Any) -> None:
            raise AssertionError("open circuit must fail before creating an HTTP client")

    redis = MemoryRedis()
    redis.store[chat_service.CIRCUIT_KEY_OLLAMA] = json.dumps(
        {"state": "open", "failures": 3, "opened_at": time.time()}
    )
    monkeypatch.setattr(chat_service, "get_redis", lambda: redis)
    monkeypatch.setattr(chat_service.httpx, "AsyncClient", UnexpectedHttpClient)
    service = OllamaChatService()

    started = time.monotonic()
    results = await asyncio.gather(
        *(service.generate(f"Request {index}") for index in range(10)),
        return_exceptions=True,
    )
    elapsed = time.monotonic() - started

    assert elapsed < 1.0
    assert all(isinstance(result, ModelServiceError) for result in results)
    assert {getattr(result, "status_code", None) for result in results} == {503}


@pytest.mark.asyncio
async def test_wrong_active_workspace_scope_returns_not_found_without_cross_workspace_data(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    async def fake_rate_limit(user_id: str) -> None:
        return None

    async def fake_active_workspace_access(request: Any, user_id: str) -> WorkspaceAccess:
        assert request.headers["X-Omnix-Workspace"] == "workspace-denied"
        raise HTTPException(status_code=404, detail="Workspace not found.")

    async def fail_insert(*args: Any, **kwargs: Any) -> None:
        raise AssertionError("chat must not create conversation rows when workspace scope is invalid")

    monkeypatch.setattr(messages, "_check_rate_limit", fake_rate_limit)
    monkeypatch.setattr(messages, "require_active_workspace_access", fake_active_workspace_access)
    monkeypatch.setattr(messages, "insert_one", fail_insert)

    with pytest.raises(HTTPException) as exc_info:
        await messages.chat(
            request=_request("workspace-denied"),
            payload=ChatRequest(message="Show workspace data"),
            current_user={"sub": "user-1"},
        )

    assert exc_info.value.status_code == 404
