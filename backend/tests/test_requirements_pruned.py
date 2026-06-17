from __future__ import annotations

import re
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[2]
REQUIREMENTS_FILE = REPO_ROOT / "backend" / "requirements.txt"

CONFIRMED_DEAD_PACKAGES = {
    "keras",
    "pandas",
    "platformio",
    "pyelftools",
    "scikit-learn",
    "seaborn",
    "tensorflow",
    "torch",
}

CONFIRMED_DEAD_PREFIXES = (
    "gradio",
    "ipython",
    "jupyter",
    "langchain",
    "langgraph",
    "matplotlib",
    "notebook",
)

ACTIVE_BACKEND_PACKAGES = {
    "aiofiles",
    "alembic",
    "beautifulsoup4",
    "cryptography",
    "faiss-cpu",
    "fastapi",
    "httpx",
    "numpy",
    "opentelemetry-api",
    "pillow",
    "psycopg",
    "psycopg-binary",
    "pydantic",
    "pydantic-settings",
    "pyjwt",
    "pypdf",
    "pypdfium2",
    "pytesseract",
    "pytest",
    "pytest-asyncio",
    "python-docx",
    "python-multipart",
    "pyyaml",
    "redis",
    "sentence-transformers",
    "sqlalchemy",
    "starlette",
    "supabase",
    "supabase-auth",
    "tiktoken",
    "uvicorn",
}


def _requirement_name(line: str) -> str | None:
    line = line.split("#", 1)[0].strip()
    if not line or line.startswith(("-r", "--")):
        return None
    match = re.match(r"^([A-Za-z0-9_.-]+)", line)
    if match is None:
        return None
    return match.group(1).lower().replace("_", "-")


def _direct_requirements() -> set[str]:
    return {
        name
        for line in REQUIREMENTS_FILE.read_text(encoding="utf-8").splitlines()
        if (name := _requirement_name(line)) is not None
    }


def test_backend_requirements_are_pruned_to_direct_dependencies() -> None:
    requirements = _direct_requirements()

    assert len(requirements) < 60
    assert ACTIVE_BACKEND_PACKAGES <= requirements


def test_backend_requirements_do_not_reintroduce_known_dead_dependencies() -> None:
    requirements = _direct_requirements()

    dead_exact_matches = CONFIRMED_DEAD_PACKAGES & requirements
    dead_prefix_matches = {
        name
        for name in requirements
        if any(name == prefix or name.startswith(f"{prefix}-") for prefix in CONFIRMED_DEAD_PREFIXES)
    }

    assert dead_exact_matches == set()
    assert dead_prefix_matches == set()
