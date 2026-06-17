from __future__ import annotations

import os
from pathlib import Path
import shutil
import subprocess
import sys


REPO_ROOT = Path(__file__).resolve().parents[3]
BACKEND_DIR = REPO_ROOT / "backend"


def test_alembic_runner_declares_empty_sql_baseline() -> None:
    ini = BACKEND_DIR / "alembic.ini"
    env = BACKEND_DIR / "alembic" / "env.py"
    versions_dir = BACKEND_DIR / "alembic" / "versions"

    assert ini.exists()
    assert env.exists()
    assert versions_dir.exists()
    assert "script_location = %(here)s/alembic" in ini.read_text(encoding="utf-8")

    baselines = sorted(versions_dir.glob("*baseline*.py"))
    assert len(baselines) == 1
    baseline = baselines[0].read_text(encoding="utf-8")
    assert "revision = \"0045_existing_sql_baseline\"" in baseline
    assert "down_revision = None" in baseline
    assert "def upgrade() -> None:" in baseline
    assert "def downgrade() -> None:" in baseline
    assert "Historical SQL migrations are stamped, not replayed" in baseline


def test_deployment_startup_runs_alembic_before_api() -> None:
    start_script = (BACKEND_DIR / "scripts" / "start_api.sh").read_text(encoding="utf-8")
    dockerfile = (BACKEND_DIR / "Dockerfile.backend").read_text(encoding="utf-8")
    prod_compose = (REPO_ROOT / "docker-compose.prod.yml").read_text(encoding="utf-8")

    assert "alembic upgrade head" in start_script
    assert 'exec "$@"' in start_script
    assert "scripts/start_api.sh" in dockerfile
    assert "scripts/start_api.sh" in prod_compose
    assert prod_compose.index("scripts/start_api.sh") < prod_compose.index("uvicorn")


def test_alembic_current_and_empty_revision_can_run_in_temp_database(tmp_path: Path) -> None:
    temp_backend = tmp_path / "backend"
    shutil.copytree(BACKEND_DIR / "alembic", temp_backend / "alembic")
    shutil.copy(BACKEND_DIR / "alembic.ini", temp_backend / "alembic.ini")

    env = {
        **os.environ,
        "DATABASE_URL": f"sqlite:///{tmp_path / 'alembic.db'}",
    }

    upgrade = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=temp_backend,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert upgrade.returncode == 0, upgrade.stderr

    current = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "current"],
        cwd=temp_backend,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert current.returncode == 0, current.stderr
    assert "0046_message_feedback" in current.stdout

    revision = subprocess.run(
        [
            sys.executable,
            "-m",
            "alembic",
            "-c",
            "alembic.ini",
            "revision",
            "--rev-id",
            "empty_smoke",
            "-m",
            "empty smoke",
        ],
        cwd=temp_backend,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert revision.returncode == 0, revision.stderr
    assert (temp_backend / "alembic" / "versions" / "empty_smoke_empty_smoke.py").exists()

    upgrade_new = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head"],
        cwd=temp_backend,
        env=env,
        text=True,
        capture_output=True,
        check=False,
    )
    assert upgrade_new.returncode == 0, upgrade_new.stderr
