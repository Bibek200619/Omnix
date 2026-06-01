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

@pytest.mark.asyncio
async def test_update_decision_status(mock_user_id, mock_workspace_id):
    decision_id = "dec-789"
    with patch("app.services.workspace_decision_service.require_decision", AsyncMock(return_value={"id": decision_id, "title": "Test"})), \
         patch("app.services.workspace_decision_service.update_one_trusted", AsyncMock(return_value={"id": decision_id, "title": "Test", "status": "accepted", "created_by": mock_user_id})), \
         patch("app.services.workspace_decision_service.get_profiles", AsyncMock(return_value={})), \
         patch("app.services.workspace_decision_service.log_workspace_activity", AsyncMock()):
        
        result = await service.update_decision_status(
            workspace_id=mock_workspace_id,
            decision_id=decision_id,
            user_id=mock_user_id,
            status="accepted"
        )
        assert result["status"] == "accepted"

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
