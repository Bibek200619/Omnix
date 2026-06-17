from __future__ import annotations

from typing import Any

from app.services import supabase_service


class FakeQuery:
    def __init__(self) -> None:
        self.calls: list[tuple[Any, ...]] = []

    def filter(self, column: str, operator: str, criteria: str):
        self.calls.append(("filter", column, operator, criteria))
        return self

    def eq(self, column: str, value: Any):
        self.calls.append(("eq", column, value))
        return self


def test_apply_filters_supports_full_text_operator_with_config() -> None:
    query = FakeQuery()

    result = supabase_service._apply_filters(
        query,
        {
            "workspace_id": "workspace-1",
            "content": {"fts": {"config": "english", "query": "launch:*"}},
        },
    )

    assert result is query
    assert query.calls == [
        ("eq", "workspace_id", "workspace-1"),
        ("filter", "content", "fts(english)", "launch:*"),
    ]
