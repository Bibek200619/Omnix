from __future__ import annotations

from collections import defaultdict
from pathlib import Path


MIGRATIONS_DIR = Path("backend/migrations")
MIGRATIONS_DOC = Path("backend/MIGRATIONS.md")


def _migration_id(path: Path) -> str:
    return path.name.split("_", 1)[0]


def test_raw_sql_migration_identifiers_are_unique() -> None:
    ids_to_files: dict[str, list[str]] = defaultdict(list)

    for migration in sorted(MIGRATIONS_DIR.glob("*.sql")):
        ids_to_files[_migration_id(migration)].append(migration.name)

    duplicates = {
        migration_id: files
        for migration_id, files in ids_to_files.items()
        if len(files) > 1
    }

    assert duplicates == {}


def test_renumbered_0032_initiatives_migration_is_documented() -> None:
    migration_names = {migration.name for migration in MIGRATIONS_DIR.glob("*.sql")}
    doc = MIGRATIONS_DOC.read_text(encoding="utf-8")

    assert "0032b_workspace_operational_initiatives.sql" in migration_names
    assert "0032b_workspace_operational_initiatives.sql" in doc
    assert "0032_workspace_operational_initiatives.sql" in doc
