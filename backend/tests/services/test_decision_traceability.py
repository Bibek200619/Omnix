import pytest
from unittest.mock import AsyncMock, patch
from app.services import workspace_decision_service as service
from app.services import workspace_initiative_service as init_service
from app.services import workspace_task_service as task_service
from app.services.supabase_service import SupabaseServiceError

@pytest.fixture
def mock_user_id():
    return "user-123"

@pytest.fixture
def mock_workspace_id():
    return "ws-456"


@pytest.fixture(autouse=True)
def stub_mention_hydration(monkeypatch: pytest.MonkeyPatch):
    async def fake_mentions_by_source(**kwargs):
        return {}

    monkeypatch.setattr(service, "mention_metadata_for_sources", fake_mentions_by_source)
    monkeypatch.setattr(task_service, "mention_metadata_for_sources", fake_mentions_by_source)


@pytest.mark.asyncio
@pytest.mark.parametrize(
    ("from_status", "to_status"),
    [
        ("proposed", "accepted"),
        ("proposed", "rejected"),
        ("accepted", "superseded"),
    ],
)
async def test_update_decision_status_lifecycle_uses_trusted_filters_first(mock_user_id, mock_workspace_id, from_status, to_status):
    decision_id = "dec-789"
    captured: dict[str, object] = {}

    async def fake_update(table: str, filters: dict[str, object], payload: dict[str, object]):
        captured["table"] = table
        captured["filters"] = filters
        captured["payload"] = payload
        return {
            "id": decision_id,
            "workspace_id": mock_workspace_id,
            "title": "Test",
            "status": payload["status"],
            "created_by": mock_user_id,
        }

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        assert table == "workspace_decision_tasks"
        assert filters == {"decision_id": decision_id, "workspace_id": mock_workspace_id}
        return []

    with patch("app.services.workspace_decision_service.require_decision", AsyncMock(return_value={"id": decision_id, "title": "Test", "status": from_status})), \
         patch("app.services.workspace_decision_service.update_one_trusted", fake_update), \
         patch("app.services.workspace_decision_service.select_all_trusted", fake_select_all), \
         patch("app.services.workspace_decision_service.get_profiles", AsyncMock(return_value={})), \
         patch("app.services.workspace_decision_service.log_workspace_activity", AsyncMock()):
        
        result = await service.update_decision_status(
            workspace_id=mock_workspace_id,
            decision_id=decision_id,
            user_id=mock_user_id,
            status=to_status
        )
        assert result["status"] == to_status
        assert captured["table"] == "workspace_decisions"
        assert captured["filters"] == {"id": decision_id, "workspace_id": mock_workspace_id}
        assert isinstance(captured["payload"], dict)
        assert captured["payload"]["status"] == to_status

@pytest.mark.asyncio
async def test_link_task_to_decision(mock_user_id, mock_workspace_id):
    decision_id = "dec-789"
    task_id = "task-000"
    
    with patch("app.services.workspace_decision_service.require_decision", AsyncMock()), \
         patch("app.services.workspace_decision_service.select_one_trusted", AsyncMock(return_value={"id": task_id})), \
         patch("app.services.workspace_decision_service.insert_one_trusted", AsyncMock()) as mock_insert, \
         patch("app.services.workspace_decision_service.get_decision", AsyncMock(return_value={"id": decision_id, "linked_tasks": [{"id": task_id}]})):
        
        result = await service.link_task_to_decision(
            workspace_id=mock_workspace_id,
            decision_id=decision_id,
            task_id=task_id,
            user_id=mock_user_id
        )
        assert len(result["linked_tasks"]) == 1
        assert result["linked_tasks"][0]["id"] == task_id
        mock_insert.assert_called_once()

@pytest.mark.asyncio
async def test_link_initiative_to_decision(mock_user_id, mock_workspace_id):
    decision_id = "dec-789"
    initiative_id = "init-111"
    
    with patch("app.services.workspace_decision_service.require_decision", AsyncMock()), \
         patch("app.services.workspace_decision_service.select_one_trusted", AsyncMock(return_value={"id": initiative_id})), \
         patch("app.services.workspace_decision_service.update_one_trusted", AsyncMock(return_value={"id": decision_id, "initiative_id": initiative_id, "created_by": mock_user_id})) as mock_update, \
         patch("app.services.workspace_decision_service.select_all_trusted", AsyncMock(return_value=[])), \
         patch("app.services.workspace_decision_service.get_profiles", AsyncMock(return_value={})):
        
        result = await service.link_initiative_to_decision(
            workspace_id=mock_workspace_id,
            decision_id=decision_id,
            initiative_id=initiative_id,
            user_id=mock_user_id
        )
        assert result["initiative_id"] == initiative_id
        mock_update.assert_called_once()


@pytest.mark.asyncio
@pytest.mark.parametrize("initiative_id", ["init-111", None])
async def test_link_initiative_to_decision_uses_trusted_filters_first(mock_user_id, mock_workspace_id, initiative_id):
    decision_id = "dec-789"
    captured: dict[str, object] = {}

    async def fake_select_one(table: str, columns: str, filters: dict[str, object]):
        assert table == "workspace_initiatives"
        assert filters == {"id": initiative_id, "workspace_id": mock_workspace_id}
        return {"id": initiative_id}

    async def fake_update(table: str, filters: dict[str, object], payload: dict[str, object]):
        captured["table"] = table
        captured["filters"] = filters
        captured["payload"] = payload
        return {
            "id": decision_id,
            "workspace_id": mock_workspace_id,
            "initiative_id": payload["initiative_id"],
            "created_by": mock_user_id,
            "status": "accepted",
            "title": "Decision",
        }

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        assert table == "workspace_decision_tasks"
        assert filters == {"decision_id": decision_id, "workspace_id": mock_workspace_id}
        return []

    with patch("app.services.workspace_decision_service.require_decision", AsyncMock()), \
         patch("app.services.workspace_decision_service.select_one_trusted", fake_select_one), \
         patch("app.services.workspace_decision_service.update_one_trusted", fake_update), \
         patch("app.services.workspace_decision_service.select_all_trusted", fake_select_all), \
         patch("app.services.workspace_decision_service.get_profiles", AsyncMock(return_value={})):

        result = await service.link_initiative_to_decision(
            workspace_id=mock_workspace_id,
            decision_id=decision_id,
            initiative_id=initiative_id,
            user_id=mock_user_id,
        )

    assert result["initiative_id"] == initiative_id
    assert captured["table"] == "workspace_decisions"
    assert captured["filters"] == {"id": decision_id, "workspace_id": mock_workspace_id}
    assert isinstance(captured["payload"], dict)
    assert captured["payload"]["initiative_id"] == initiative_id

@pytest.mark.asyncio
async def test_task_hydration_with_decisions(mock_user_id, mock_workspace_id):
    task_id = "task-1"
    decision_id = "dec-1"
    
    with patch("app.services.workspace_task_service.require_workspace_access", AsyncMock()), \
         patch("app.services.workspace_task_service.select_all_trusted") as mock_select, \
         patch("app.services.workspace_task_service.get_profiles", AsyncMock(return_value={})):
        
        # Mocking task select, then decision_tasks select, then decisions select
        mock_select.side_effect = [
            [{"id": task_id, "workspace_id": mock_workspace_id, "owner_user_id": mock_user_id, "created_by": mock_user_id}], # tasks
            [{"decision_id": decision_id}], # decision_tasks links
            [{"id": decision_id, "title": "Decision 1", "status": "accepted"}] # decisions
        ]
        
        result = await task_service.list_tasks(workspace_id=mock_workspace_id, user_id=mock_user_id)
        assert len(result) == 1
        assert len(result[0]["linked_decisions"]) == 1
        assert result[0]["linked_decisions"][0]["title"] == "Decision 1"


@pytest.mark.asyncio
async def test_task_hydration_uses_supported_list_filter(mock_user_id, mock_workspace_id):
    task_id = "task-1"
    decision_id = "dec-1"
    observed_filters: list[dict[str, object]] = []

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        observed_filters.append(filters)
        if table == "workspace_decision_tasks":
            return [{"decision_id": decision_id}]
        if table == "workspace_decisions":
            return [{"id": decision_id, "title": "Decision 1", "status": "accepted"}]
        raise AssertionError(table)

    with patch("app.services.workspace_task_service.select_all_trusted", fake_select_all), \
         patch("app.services.workspace_task_service.get_profiles", AsyncMock(return_value={})):
        result = await task_service._hydrate_tasks([
            {
                "id": task_id,
                "workspace_id": mock_workspace_id,
                "owner_user_id": mock_user_id,
                "created_by": mock_user_id,
            }
        ])

    assert result[0]["linked_decisions"][0]["id"] == decision_id
    assert observed_filters[0] == {"task_id": task_id, "workspace_id": mock_workspace_id}
    assert observed_filters[1] == {"id": [decision_id], "workspace_id": mock_workspace_id}

@pytest.mark.asyncio
async def test_initiative_hydration_with_decisions(mock_user_id, mock_workspace_id):
    init_id = "init-1"
    decision_id = "dec-1"
    
    with patch("app.services.workspace_initiative_service.require_workspace_access", AsyncMock()), \
         patch("app.services.workspace_initiative_service._base_records", AsyncMock(return_value=([], [], []))), \
         patch("app.services.workspace_initiative_service.select_all_trusted") as mock_select, \
         patch("app.services.workspace_initiative_service.get_profiles", AsyncMock(return_value={})):
        
        # Mocking initiative select, then decisions select
        mock_select.side_effect = [
            [{"id": init_id, "workspace_id": mock_workspace_id, "created_by": mock_user_id}], # initiatives
            [{"id": decision_id, "title": "Decision 1", "status": "accepted"}] # decisions
        ]
        
        result = await init_service.list_initiatives(workspace_id=mock_workspace_id, user_id=mock_user_id)
        assert len(result) == 1
        assert len(result[0]["linked_decisions"]) == 1
        assert result[0]["linked_decisions"][0]["title"] == "Decision 1"


@pytest.mark.asyncio
async def test_decision_hydration_uses_supported_task_list_filter(mock_user_id, mock_workspace_id):
    decision_id = "dec-1"
    task_id = "task-1"
    observed_filters: list[dict[str, object]] = []

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        observed_filters.append(filters)
        if table == "workspace_decision_tasks":
            return [{"task_id": task_id}]
        if table == "workspace_tasks":
            return [{"id": task_id, "title": "Task 1", "status": "active"}]
        raise AssertionError(table)

    with patch("app.services.workspace_decision_service.select_all_trusted", fake_select_all), \
         patch("app.services.workspace_decision_service.get_profiles", AsyncMock(return_value={})):
        result = await service._hydrate_decisions([
            {
                "id": decision_id,
                "workspace_id": mock_workspace_id,
                "title": "Decision",
                "status": "accepted",
                "created_by": mock_user_id,
            }
        ], expand_links=True)

    assert result[0]["linked_tasks"][0]["id"] == task_id
    assert observed_filters[0] == {"decision_id": decision_id, "workspace_id": mock_workspace_id}
    assert observed_filters[1] == {"id": [task_id], "workspace_id": mock_workspace_id}


@pytest.mark.asyncio
async def test_initiative_hydration_uses_workspace_scoped_decision_filter(mock_user_id, mock_workspace_id):
    init_id = "init-1"
    observed_filters: list[dict[str, object]] = []

    async def fake_select_all(table: str, columns: str, filters: dict[str, object], **kwargs):
        observed_filters.append(filters)
        return [{"id": "dec-1", "title": "Decision 1", "status": "accepted"}]

    with patch("app.services.workspace_initiative_service._base_records", AsyncMock(return_value=([], [], []))), \
         patch("app.services.workspace_initiative_service.select_all_trusted", fake_select_all), \
         patch("app.services.workspace_initiative_service.get_profiles", AsyncMock(return_value={})):

        result = await init_service._hydrate_initiatives(
            [{"id": init_id, "workspace_id": mock_workspace_id, "created_by": mock_user_id, "status": "active"}],
            workspace_id=mock_workspace_id,
            user_id=mock_user_id,
        )

    assert result[0]["linked_decisions"][0]["id"] == "dec-1"
    assert observed_filters == [{"initiative_id": init_id, "workspace_id": mock_workspace_id}]


@pytest.mark.asyncio
async def test_initiative_hydration_survives_missing_decision_previews(mock_user_id, mock_workspace_id):
    async def failing_select_all(*args, **kwargs):
        raise SupabaseServiceError("missing preview table")

    with patch("app.services.workspace_initiative_service._base_records", AsyncMock(return_value=([], [], []))), \
         patch("app.services.workspace_initiative_service.select_all_trusted", failing_select_all), \
         patch("app.services.workspace_initiative_service.get_profiles", AsyncMock(return_value={})):

        result = await init_service._hydrate_initiatives(
            [{"id": "init-1", "workspace_id": mock_workspace_id, "created_by": mock_user_id, "status": "active"}],
            workspace_id=mock_workspace_id,
            user_id=mock_user_id,
        )

    assert result[0]["linked_decisions"] == []
    assert result[0]["momentum"]["health"] == "quiet"
