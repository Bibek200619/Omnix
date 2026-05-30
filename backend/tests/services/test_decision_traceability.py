import pytest
from unittest.mock import AsyncMock, patch
from app.services import workspace_decision_service as service
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
