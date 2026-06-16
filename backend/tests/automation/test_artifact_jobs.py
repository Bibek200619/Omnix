from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.automation import artifact_jobs


@pytest.mark.asyncio
async def test_cleanup_old_artifacts_deletes_only_artifacts_past_cutoff(monkeypatch: pytest.MonkeyPatch) -> None:
    old_created_at = (datetime.now(timezone.utc) - timedelta(days=200)).isoformat()
    fresh_created_at = datetime.now(timezone.utc).isoformat()
    deleted_filters: list[dict[str, object]] = []

    async def fake_select_all(table, columns, filters=None, order_by=None, desc=False, limit=None, offset=None):
        assert table == "artifacts"
        assert columns == "id,workspace_id,created_at"
        assert filters == {"workspace_id": "workspace-1"}
        return [
            {"id": "old-artifact", "workspace_id": "workspace-1", "created_at": old_created_at},
            {"id": "fresh-artifact", "workspace_id": "workspace-1", "created_at": fresh_created_at},
        ]

    async def fake_delete_many(table, filters):
        assert table == "artifacts"
        deleted_filters.append(dict(filters))
        return [{"id": filters["id"]}]

    monkeypatch.setattr(artifact_jobs, "select_all_trusted", fake_select_all)
    monkeypatch.setattr(artifact_jobs, "delete_many_trusted", fake_delete_many)

    result = await artifact_jobs.cleanup_old_artifacts("workspace-1", days=180)

    assert result == {"deleted_count": 1}
    assert deleted_filters == [{"workspace_id": "workspace-1", "id": "old-artifact"}]
