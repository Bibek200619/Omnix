from __future__ import annotations

import json
from typing import Any
from unittest.mock import AsyncMock

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient

from app.automation import workspace_jobs
from app.automation.scheduler import AutomationScheduler
from app.core.security import get_current_user
from app.jobs import automation_jobs, queue
from app.routers import automations
from app.services import supabase_service, workspace_service


@pytest.fixture
def automation_row() -> dict[str, Any]:
    return {
        "id": "automation-a",
        "workspace_id": "workspace-a",
        "user_id": "owner",
        "job_type": "daily_summary",
        "enabled": False,
    }


def client() -> TestClient:
    app = FastAPI()
    app.dependency_overrides[get_current_user] = lambda: {"sub": "actor"}
    app.include_router(automations.router)
    return TestClient(app, raise_server_exceptions=False)


@pytest.mark.parametrize("delivery", ["success", "redis_failure", "db_failure"])
def test_manual_run_persists_before_acknowledging_and_never_executes_in_api(
    monkeypatch: pytest.MonkeyPatch, automation_row: dict[str, Any], delivery: str
) -> None:
    access = AsyncMock()
    select = AsyncMock(return_value=[automation_row])
    insert = AsyncMock(
        side_effect=RuntimeError("test-db-failure")
        if delivery == "db_failure"
        else None
    )
    push = AsyncMock(
        side_effect=RuntimeError("test-redis-failure")
        if delivery == "redis_failure"
        else None
    )
    api_runner = AsyncMock()
    monkeypatch.setattr(automations, "require_workspace_access", access)
    monkeypatch.setattr(automations, "select_all_trusted", select)
    monkeypatch.setattr(supabase_service, "insert_one_trusted", insert)
    monkeypatch.setattr(queue, "push_job_id", push)
    monkeypatch.setattr(AutomationScheduler.get(), "run_now", api_runner)
    with client() as api:
        response = api.post("/workspaces/workspace-a/automations/automation-a/run")
    api_runner.assert_not_awaited()
    access.assert_awaited_once_with("workspace-a", "actor")
    select.assert_awaited_once()
    assert select.await_args.args[2] == {
        "id": "automation-a",
        "workspace_id": "workspace-a",
    }
    insert.assert_awaited_once()
    record = insert.await_args.args[1]
    assert record["status"] == "queued"
    assert record["payload"]["type"] == "run_automation"
    assert record["payload"]["automation_id"] == "automation-a"
    assert record["payload"]["workspace_id"] == "workspace-a"
    assert record["payload"]["user_id"] == "actor"
    assert record["payload"]["_queue"] == queue.primary_job_queue()
    assert "job_type" not in record["payload"]
    if delivery == "db_failure":
        assert response.status_code == 503
        push.assert_not_awaited()
    else:
        assert response.status_code == 202
        assert response.json() == {"status": "queued", "job_id": record["id"]}
        push.assert_awaited_once()


def test_missing_or_foreign_automation_is_not_enqueued(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    monkeypatch.setattr(automations, "require_workspace_access", AsyncMock())
    monkeypatch.setattr(automations, "select_all_trusted", AsyncMock(return_value=[]))
    enqueue = AsyncMock()
    monkeypatch.setattr(queue, "enqueue_job", enqueue)
    with client() as api:
        response = api.post("/workspaces/workspace-a/automations/foreign/run")
    assert response.status_code == 404
    enqueue.assert_not_awaited()


def test_revoked_caller_cannot_enqueue(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        automations,
        "require_workspace_access",
        AsyncMock(side_effect=HTTPException(404, "Workspace not found.")),
    )
    select = AsyncMock()
    enqueue = AsyncMock()
    monkeypatch.setattr(automations, "select_all_trusted", select)
    monkeypatch.setattr(queue, "enqueue_job", enqueue)
    with client() as api:
        assert (
            api.post("/workspaces/workspace-a/automations/automation-a/run").status_code
            == 404
        )
    select.assert_not_awaited()
    enqueue.assert_not_awaited()


@pytest.fixture
def execution(
    monkeypatch: pytest.MonkeyPatch, automation_row: dict[str, Any]
) -> tuple[AsyncMock, AsyncMock, AsyncMock]:
    select = AsyncMock(return_value=automation_row)
    access = AsyncMock()
    run = AsyncMock(return_value={"artifact": {"id": "artifact-a"}})
    monkeypatch.setattr(supabase_service, "select_one_trusted", select)
    monkeypatch.setattr(workspace_service, "require_workspace_access", access)
    monkeypatch.setattr(workspace_jobs, "run_automation_job", run)
    return select, access, run


def job_payload() -> dict[str, str]:
    return {
        "automation_id": "automation-a",
        "workspace_id": "workspace-a",
        "user_id": "actor",
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("encoded", [False, True])
async def test_worker_fetches_authoritative_automation_and_runs_as_requesting_actor(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock], encoded: bool
) -> None:
    select, access, run = execution
    payload = {
        **job_payload(),
        "job_type": "cleanup_stale_presence",
        "owner_user_id": "spoofed",
    }
    result = await automation_jobs.handle_run_automation(
        {"payload": json.dumps(payload) if encoded else payload}
    )
    assert result == {
        "status": "completed",
        "result": {"artifact": {"id": "artifact-a"}},
    }
    assert select.await_args.args[2] == {
        "id": "automation-a",
        "workspace_id": "workspace-a",
    }
    assert access.await_args_list[0].args == ("workspace-a", "actor")
    assert access.await_args_list[1].args == ("workspace-a", "owner")
    actual = run.await_args.args[0]
    assert actual["job_type"] == "daily_summary"
    assert actual["user_id"] == "actor"
    assert (
        actual["enabled"] is False
    )  # explicit manual invocation, schedule remains disabled


@pytest.mark.asyncio
@pytest.mark.parametrize("revoked_user", ["actor", "owner"])
async def test_revoked_access_blocks_execution(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock], revoked_user: str
) -> None:
    _, access, run = execution

    async def check_access(workspace_id: str, user_id: str) -> None:
        if user_id == revoked_user:
            raise HTTPException(404, "Workspace not found.")

    access.side_effect = check_access
    result = await automation_jobs.handle_run_automation({"payload": job_payload()})
    assert result["status"] == "failed"
    run.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("missing", [True, False])
async def test_deleted_or_foreign_automation_does_no_work(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock], missing: bool
) -> None:
    select, access, run = execution
    select.return_value = (
        None if missing else {"id": "automation-a", "workspace_id": "foreign"}
    )
    result = await automation_jobs.handle_run_automation({"payload": job_payload()})
    assert result["status"] == "failed"
    access.assert_not_awaited()
    run.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize("changed", [{"id": "another-automation"}, {"user_id": None}])
async def test_invalid_authoritative_identity_blocks_execution(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock],
    automation_row: dict[str, Any],
    changed: dict[str, Any],
) -> None:
    _, access, run = execution
    automation_row.update(changed)
    assert (await automation_jobs.handle_run_automation({"payload": job_payload()}))[
        "status"
    ] == "failed"
    access.assert_not_awaited()
    run.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "payload", [None, "bad-json", "[]", {}, {"automation_id": "automation-a"}]
)
async def test_malformed_payload_fails_before_reads(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock], payload: Any
) -> None:
    select, access, run = execution
    assert (await automation_jobs.handle_run_automation({"payload": payload}))[
        "status"
    ] == "failed"
    select.assert_not_awaited()
    access.assert_not_awaited()
    run.assert_not_awaited()


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "result",
    [
        {"artifact": None},
        {"error": "unknown job_type"},
        {"status": "deferred"},
        {"status": "failed"},
    ],
)
async def test_runner_failure_is_not_reported_completed(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock], result: dict[str, Any]
) -> None:
    _, _, run = execution
    run.return_value = result
    assert (await automation_jobs.handle_run_automation({"payload": job_payload()}))[
        "status"
    ] == "failed"


@pytest.mark.asyncio
async def test_system_cleanup_cannot_be_selected_by_a_workspace_automation(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock], automation_row: dict[str, Any]
) -> None:
    _, _, run = execution
    automation_row["job_type"] = "cleanup_stale_presence"
    assert (await automation_jobs.handle_run_automation({"payload": job_payload()}))[
        "status"
    ] == "failed"
    run.assert_not_awaited()


@pytest.mark.asyncio
async def test_runner_exception_is_redacted(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock], caplog: pytest.LogCaptureFixture
) -> None:
    _, _, run = execution
    run.side_effect = RuntimeError("private-source-marker")
    result = await automation_jobs.handle_run_automation({"payload": job_payload()})
    assert result["status"] == "failed"
    assert "private-source-marker" not in str(result) + caplog.text


@pytest.mark.asyncio
async def test_database_failure_does_not_execute_or_expose_error(
    execution: tuple[AsyncMock, AsyncMock, AsyncMock], caplog: pytest.LogCaptureFixture
) -> None:
    select, access, run = execution
    select.side_effect = RuntimeError("private-database-marker")
    result = await automation_jobs.handle_run_automation({"payload": job_payload()})
    assert result["status"] == "failed"
    assert "private-database-marker" not in str(result) + caplog.text
    access.assert_not_awaited()
    run.assert_not_awaited()


def test_persisted_manual_job_can_be_consumed_after_redis_failure(
    monkeypatch: pytest.MonkeyPatch, automation_row: dict[str, Any]
) -> None:
    monkeypatch.setattr(automations, "require_workspace_access", AsyncMock())
    monkeypatch.setattr(
        automations, "select_all_trusted", AsyncMock(return_value=[automation_row])
    )
    insert = AsyncMock()
    monkeypatch.setattr(supabase_service, "insert_one_trusted", insert)
    monkeypatch.setattr(
        queue, "push_job_id", AsyncMock(side_effect=RuntimeError("redis unavailable"))
    )
    monkeypatch.setattr(
        supabase_service, "select_one_trusted", AsyncMock(return_value=automation_row)
    )
    monkeypatch.setattr(workspace_service, "require_workspace_access", AsyncMock())
    runner = AsyncMock(return_value={"artifact": {"id": "artifact-a"}})
    monkeypatch.setattr(workspace_jobs, "run_automation_job", runner)
    with client() as api:
        response = api.post("/workspaces/workspace-a/automations/automation-a/run")
        assert response.status_code == 202
        stored = insert.await_args.args[1]
        result = api.portal.call(automation_jobs.handle_run_automation, stored)
    assert result["status"] == "completed"
    assert response.json()["job_id"] == stored["id"]
    runner.assert_awaited_once()
