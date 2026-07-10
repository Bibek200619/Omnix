from __future__ import annotations

import ast
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[2]
APP_ROOT = BACKEND_ROOT / "app"
LEGACY_LLM_ROOT = APP_ROOT / "services" / "llm"


def test_legacy_placeholder_llm_package_is_retired() -> None:
    assert list(LEGACY_LLM_ROOT.rglob("*.py")) == []


def test_runtime_modules_do_not_import_retired_llm_package() -> None:
    forbidden_prefixes = {"app.services.llm", "backend.app.services.llm"}
    offenders: list[str] = []

    for path in APP_ROOT.rglob("*.py"):
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        for node in ast.walk(tree):
            if isinstance(node, ast.Import):
                imported = {alias.name for alias in node.names}
            elif isinstance(node, ast.ImportFrom):
                imported = {node.module or ""}
                if node.level and any(name == "llm" or name.startswith("llm.") for name in imported):
                    offenders.append(str(path.relative_to(BACKEND_ROOT)))
                    continue
            else:
                continue
            if any(
                name == prefix or name.startswith(f"{prefix}.")
                for name in imported
                for prefix in forbidden_prefixes
            ):
                offenders.append(str(path.relative_to(BACKEND_ROOT)))

    assert offenders == []
