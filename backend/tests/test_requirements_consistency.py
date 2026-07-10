from __future__ import annotations

from collections import Counter
from pathlib import Path

from packaging.requirements import Requirement


REQUIREMENTS_PATH = Path(__file__).resolve().parents[1] / "requirements.txt"


def _requirements() -> list[Requirement]:
    requirements: list[Requirement] = []
    for raw_line in REQUIREMENTS_PATH.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith(("#", "-")):
            continue
        requirements.append(Requirement(line))
    return requirements


def test_backend_requirements_have_unique_package_names() -> None:
    names = [requirement.name.lower().replace("_", "-") for requirement in _requirements()]
    duplicates = sorted(name for name, count in Counter(names).items() if count > 1)

    assert duplicates == []


def test_backend_uses_validated_pytest_pin() -> None:
    pytest_requirement = next(
        requirement for requirement in _requirements() if requirement.name.lower() == "pytest"
    )

    assert str(pytest_requirement.specifier) == "==9.0.3"
