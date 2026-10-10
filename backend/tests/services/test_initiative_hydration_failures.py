from __future__ import annotations

import asyncio
from types import SimpleNamespace
from unittest.mock import AsyncMock

import httpx
import pytest
from fastapi import FastAPI, HTTPException

from app.routers import continuity
from app.services import workspace_initiative_service as initiatives
from app.services.supabase_service import SupabaseServiceError

PRIVATE = "private-initiative-evidence-provider-sentinel"
SOURCES = ["tasks", "channels", "links", "decisions"]
ROW = {
    "id": "initiative-1",
    "workspace_id": "workspace-1",
    "title": "Launch",
    "status": "active",
}


@pytest.fixture
def evidence(monkeypatch):
    access = AsyncMock(return_value=SimpleNamespace(workspace={"id": "workspace-1"}))
    tasks = AsyncMock(
        return_value=[
            {
                "id": "task-1",
                "initiative_id": "initiative-1",
                "status": "active",
                "blockers": ["Waiting"],
            }
        ]
    )
    channels = AsyncMock(
        return_value=[{"id": "channel-1", "name": "launch", "message_count": 3}]
    )
    state = {"failure": None, "error": None, "empty": False}

    async def select(table, columns, filters, **kwargs):
        assert filters["workspace_id"] == "workspace-1"
        if table == "workspace_initiatives":
            return [dict(ROW)]
        if table == "workspace_initiative_channels":
            source = "links"
            rows = [
                {"initiative_id": "initiative-1", "channel_id": "channel-1"},
                {"initiative_id": "initiative-1", "channel_id": "private-channel"},
            ]
        elif table == "workspace_decisions":
            assert filters["initiative_id"] == "initiative-1"
            source = "decisions"
            rows = [{"id": "decision-1", "title": "Ship", "status": "accepted"}]
        else:
            raise AssertionError(table)
        if state["failure"] == source:
            raise state["error"] or SupabaseServiceError(PRIVATE)
        return [] if state["empty"] else rows

    async def select_one(table, columns, filters):
        assert table == "workspace_initiatives"
        assert filters == {"id": "initiative-1", "workspace_id": "workspace-1"}
        return dict(ROW)

    reads = AsyncMock(side_effect=select)
    transcript = AsyncMock(return_value=[])
    monkeypatch.setattr(initiatives, "require_workspace_access", access)
    monkeypatch.setattr(initiatives, "list_tasks", tasks)
    monkeypatch.setattr(initiatives, "list_channels", channels)
    monkeypatch.setattr(initiatives, "select_all_trusted", reads)
    monkeypatch.setattr(
        initiatives, "select_one_trusted", AsyncMock(side_effect=select_one)
    )
    monkeypatch.setattr(initiatives, "get_profiles", AsyncMock(return_value={}))
    monkeypatch.setattr(initiatives, "channel_transcript_for_assistance", transcript)

    def fail(source, error=None):
        if source in {"tasks", "channels"}:
            dependency = tasks if source == "tasks" else channels
            dependency.side_effect = error or HTTPException(500, PRIVATE)
        else:
            state["failure"] = source
            state["error"] = error

    return SimpleNamespace(
        access=access,
        tasks=tasks,
        channels=channels,
        reads=reads,
        state=state,
        fail=fail,
        transcript=transcript,
    )


async def request(endpoint):
    app = FastAPI()
    app.include_router(continuity.router)
    app.dependency_overrides[continuity.get_current_user] = lambda: {"sub": "user-1"}
    path = "/workspaces/workspace-1/initiatives"
    if endpoint == "detail":
        path += "/initiative-1"
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://test.invalid"
    ) as client:
        return await client.get(path)


@pytest.mark.asyncio
@pytest.mark.parametrize("source", SOURCES)
@pytest.mark.parametrize("endpoint", ["list", "detail"])
async def test_dependency_failure_is_unavailable_and_recovers(
    evidence, source, endpoint, caplog
):
    evidence.fail(source)
    response = await request(endpoint)
    assert response.status_code == 503
    assert PRIVATE not in response.text + caplog.text
    evidence.tasks.side_effect = None
    evidence.channels.side_effect = None
    evidence.state["failure"] = None
    recovered = await request(endpoint)
    assert recovered.status_code == 200
    row = recovered.json()[0] if endpoint == "list" else recovered.json()
    assert row["momentum"]["health"] == "blocked_execution"
    assert row["momentum"]["blocked_task_count"] == 1
    assert row["momentum"]["discussion_message_count"] == 3
    assert [channel["id"] for channel in row["linked_channels"]] == ["channel-1"]
    assert row["provenance_summary"]["decision_count"] == 1
    evidence.tasks.assert_awaited_with(workspace_id="workspace-1", user_id="user-1")
    evidence.channels.assert_awaited_with(workspace_id="workspace-1", user_id="user-1")


@pytest.mark.asyncio
@pytest.mark.parametrize("source", SOURCES)
async def test_assistance_never_receives_partial_evidence(evidence, source, caplog):
    evidence.fail(source)
    with pytest.raises(HTTPException) as caught:
        await initiatives.initiative_evidence_for_assistance(
            workspace_id="workspace-1", initiative_id="initiative-1", user_id="user-1"
        )
    assert caught.value.status_code == 503
    assert caught.value.__cause__ is None
    assert PRIVATE not in str(caught.value.detail) + caplog.text
    evidence.transcript.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["tasks", "channels"])
@pytest.mark.parametrize("code", [403, 404])
async def test_nested_access_denials_are_preserved(evidence, source, code):
    evidence.fail(source, HTTPException(code, "Access denied."))
    response = await request("detail")
    assert response.status_code == code
    assert response.json() == {"detail": "Access denied."}


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["list", "detail"])
async def test_successful_empty_evidence_is_valid(evidence, endpoint):
    evidence.tasks.return_value = []
    evidence.channels.return_value = []
    evidence.state["empty"] = True
    response = await request(endpoint)
    assert response.status_code == 200
    row = response.json()[0] if endpoint == "list" else response.json()
    assert (
        row["linked_tasks"] == row["linked_channels"] == row["linked_decisions"] == []
    )
    assert row["momentum"]["health"] == "quiet"
    assert row["provenance_summary"]["needs_repair"] is True


@pytest.mark.asyncio
@pytest.mark.parametrize("source", SOURCES)
async def test_cancellation_is_not_converted_to_success_or_503(evidence, source):
    evidence.fail(source, asyncio.CancelledError())
    with pytest.raises(asyncio.CancelledError):
        await initiatives.get_initiative(
            workspace_id="workspace-1", initiative_id="initiative-1", user_id="user-1"
        )


@pytest.mark.asyncio
@pytest.mark.parametrize("endpoint", ["list", "detail"])
@pytest.mark.parametrize("code", [403, 404])
async def test_workspace_access_denial_stops_all_evidence_reads(
    evidence, endpoint, code
):
    evidence.access.side_effect = HTTPException(code, "Workspace inaccessible.")
    response = await request(endpoint)
    assert response.status_code == code
    evidence.tasks.assert_not_awaited()
    evidence.channels.assert_not_awaited()
    evidence.reads.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("source", ["tasks", "channels"])
async def test_existing_unavailable_dependency_remains_sanitized(
    evidence, source, caplog
):
    evidence.fail(source, HTTPException(503, PRIVATE))
    response = await request("detail")
    assert response.status_code == 503
    assert PRIVATE not in response.text + caplog.text
