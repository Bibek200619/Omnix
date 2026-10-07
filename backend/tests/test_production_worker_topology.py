from __future__ import annotations

import re
import shlex
import subprocess
from pathlib import Path
from typing import Any

import pytest
import yaml


REPO_ROOT = Path(__file__).resolve().parents[2]
COMPOSE_PATH = REPO_ROOT / "docker-compose.prod.yml"
WORKER_SCRIPT_PATH = REPO_ROOT / "scripts" / "start_workers.sh"
SYSTEMD_UNIT_PATH = REPO_ROOT / "scripts" / "omnix-ingestion-worker.service"
HISTORICAL_EC2_WORKFLOW_PATH = REPO_ROOT / "docs/history/ec2-deploy-workflow.yml"


def _environment(service: dict[str, Any]) -> dict[str, str]:
    raw_environment = service.get("environment") or {}
    if isinstance(raw_environment, dict):
        return {str(key): str(value) for key, value in raw_environment.items()}

    environment: dict[str, str] = {}
    for item in raw_environment:
        key, _, value = str(item).partition("=")
        environment[key] = value
    return environment


def test_production_worker_scaling_targets_declared_ingestion_service() -> None:
    compose = yaml.safe_load(COMPOSE_PATH.read_text(encoding="utf-8"))
    services = compose["services"]
    script = WORKER_SCRIPT_PATH.read_text(encoding="utf-8")

    scale_match = re.search(r"--scale\s+([A-Za-z0-9_-]+)=", script)
    detached_service_match = re.search(r"\s-d\s+([A-Za-z0-9_-]+)", script)

    assert scale_match, (
        "The production worker script must declare a Compose scale target."
    )
    assert detached_service_match, (
        "The production worker script must start the scaled Compose service."
    )

    scale_target = scale_match.group(1)
    started_target = detached_service_match.group(1)

    assert scale_target == started_target == "ingestion-worker"
    assert scale_target in services

    ingestion_worker = services[scale_target]
    assert ingestion_worker["command"] == ["python", "-m", "app.jobs.worker"]
    assert _environment(ingestion_worker)["OMNIX_ROLE"] == "ingestion_worker"


def test_production_systemd_unit_uses_the_compose_ingestion_worker_role() -> None:
    unit = SYSTEMD_UNIT_PATH.read_text(encoding="utf-8")

    assert "Environment=OMNIX_ROLE=ingestion_worker" in unit
    assert "-m app.jobs.worker" in unit


@pytest.fixture
def ec2_deployment(tmp_path: Path):
    """Check the archived EC2 script using doubles; this is not Render verification."""
    workflow = yaml.safe_load(HISTORICAL_EC2_WORKFLOW_PATH.read_text(encoding="utf-8"))
    script = workflow["jobs"]["deploy"]["steps"][0]["with"]["script"]
    checkout = tmp_path / "Omnix"
    venv = checkout / "backend/venv/bin"
    venv.mkdir(parents=True)
    (venv / "activate").write_text(":\n", encoding="utf-8")
    script = script.replace("~/Omnix", shlex.quote(str(checkout)))

    command_dir = tmp_path / "commands"
    command_dir.mkdir()
    for command in ("git", "pip", "sudo", "sleep"):
        stub = command_dir / command
        stub.write_text(
            "#!/bin/bash\n"
            'call="${0##*/} $*"\n'
            'printf "%s\\n" "$call" >> "$DEPLOY_TEST_CALLS"\n'
            'if [[ "$call" == "$DEPLOY_TEST_FAIL_AT" ]]; then exit 23; fi\n',
            encoding="utf-8",
        )
        stub.chmod(0o755)

    calls_path = tmp_path / "calls"

    def run(fail_at: str = "") -> tuple[subprocess.CompletedProcess[str], list[str]]:
        result = subprocess.run(
            ["/bin/bash", "-c", script],
            cwd=tmp_path,
            # Only doubles are on PATH; even git reset and sudo cannot touch the host.
            env={
                "PATH": str(command_dir),
                "DEPLOY_TEST_CALLS": str(calls_path),
                "DEPLOY_TEST_FAIL_AT": fail_at,
            },
            capture_output=True,
            text=True,
            timeout=10,
            check=False,
        )
        return result, calls_path.read_text(encoding="utf-8").splitlines()

    return run


def test_historical_ec2_workflow_is_preserved_outside_active_actions() -> None:
    assert HISTORICAL_EC2_WORKFLOW_PATH.is_file()
    assert not (REPO_ROOT / ".github/workflows/deploy.yml").exists()


OCR_INSTALL = (
    "sudo install -m 0644 ../scripts/omnix-ocr-worker.service "
    "/etc/systemd/system/omnix-ocr-worker.service"
)


def test_ec2_deployment_installs_and_starts_ocr_before_reporting_success(
    ec2_deployment,
):
    result, calls = ec2_deployment()

    assert result.returncode == 0, result.stderr
    expected_order = [
        OCR_INSTALL,
        "sudo systemctl daemon-reload",
        "sudo systemctl enable omnix-ocr-worker",
        "sudo systemctl restart omnix-ocr-worker",
        "sleep 5",
        "sudo systemctl is-active --quiet omnix-ocr-worker",
    ]
    positions = [calls.index(command) for command in expected_order]
    assert positions == sorted(positions)
    assert calls.count("sudo systemctl restart omnix-ocr-worker") == 1
    for service in ("omnix", "omnix-ingestion-worker", "omnix-automation-scheduler"):
        assert f"sudo systemctl restart {service}" in calls
    assert "Deployment completed successfully" in result.stdout


@pytest.mark.parametrize(
    "failed_command",
    [
        "git fetch origin",
        "pip install -r requirements.txt --quiet",
        OCR_INSTALL,
        "sudo systemctl daemon-reload",
        "sudo systemctl enable omnix-ocr-worker",
        "sudo systemctl restart omnix-ocr-worker",
        "sudo systemctl is-active --quiet omnix-ocr-worker",
    ],
)
def test_ec2_deployment_stops_when_ocr_deployment_cannot_complete(
    ec2_deployment, failed_command: str
):
    result, calls = ec2_deployment(failed_command)

    assert result.returncode == 23
    assert calls[-1] == failed_command
    assert "Deployment completed successfully" not in result.stdout
