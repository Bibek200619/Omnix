from unittest.mock import AsyncMock

import pytest
from fastapi import HTTPException

from backend.app.services import workspace_collaboration_service as service


@pytest.mark.asyncio
async def test_activity_storage_failure_is_not_empty_success(monkeypatch, caplog):
    access = AsyncMock()
    read = AsyncMock(side_effect=service.SupabaseServiceError("private database detail"))
    monkeypatch.setattr(service, "require_workspace_access", access)
    monkeypatch.setattr(service, "select_all_trusted", read)

    with pytest.raises(HTTPException) as failure:
        await service.list_workspace_activity(workspace_id="workspace-1", user_id="user-1")

    access.assert_awaited_once_with("workspace-1", "user-1")
    assert read.call_args.kwargs["filters"] == {"workspace_id": "workspace-1"}
    assert failure.value.status_code == 503
    assert "private database detail" not in failure.value.detail
    assert "private database detail" not in caplog.text


@pytest.mark.asyncio
async def test_activity_empty_success_remains_empty(monkeypatch):
    monkeypatch.setattr(service, "require_workspace_access", AsyncMock())
    monkeypatch.setattr(service, "select_all_trusted", AsyncMock(return_value=[]))
    monkeypatch.setattr(service, "get_profiles", AsyncMock(return_value={}))

    assert await service.list_workspace_activity(workspace_id="workspace-1", user_id="user-1") == []


@pytest.mark.asyncio
async def test_activity_denial_prevents_trusted_read(monkeypatch):
    monkeypatch.setattr(service, "require_workspace_access", AsyncMock(side_effect=HTTPException(403, "Forbidden")))
    read = AsyncMock()
    monkeypatch.setattr(service, "select_all_trusted", read)

    with pytest.raises(HTTPException) as failure:
        await service.list_workspace_activity(workspace_id="workspace-2", user_id="user-1")

    assert failure.value.status_code == 403
    read.assert_not_awaited()
