from __future__ import annotations

from collections import Counter
from pathlib import Path
import re


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"


def read_frontend(relative_path: str) -> str:
    return (FRONTEND_ROOT / relative_path).read_text(encoding="utf-8")


def test_generated_design_tokens_are_not_duplicated_or_malformed() -> None:
    source = read_frontend("styles/globals.css")
    variable_names = re.findall(r"(--[A-Za-z0-9_-]+)\s*:", source)
    counts = Counter(variable_names)
    duplicate_omnix_tokens = sorted(
        name
        for name, count in counts.items()
        if count > 1 and name.startswith("--omnix-")
    )

    assert source.count("Component literal color variables: generated for audit remediation.") == 1
    assert "--omnix-rgba-rgba-" not in source
    assert duplicate_omnix_tokens == []


def test_global_motion_and_touch_standards_are_declared() -> None:
    source = read_frontend("styles/globals.css")
    task_card = read_frontend("components/tasks/TaskCard.tsx")

    assert "@media (pointer: coarse)" in source
    assert "min-width: 44px;" in source
    assert "min-height: 44px;" in source
    assert ".omnix-touch-reveal" in source
    assert "opacity: 1 !important;" in source
    assert "omnix-touch-reveal" in task_card
    assert 'data-testid="task-card-secondary-controls"' in task_card
    assert 'data-testid="task-card-blocker-controls"' in task_card
    assert "@media (prefers-reduced-motion: reduce)" in source
    assert "animation-delay: 0ms !important;" in source
    assert "transition-delay: 0ms !important;" in source
    assert ".omnix-ambient-layer::before" in source
    assert ".omnix-streaming-dot::after" in source


def test_mobile_task_create_form_does_not_use_raw_autofocus() -> None:
    source = read_frontend("components/tasks/TaskCreateForm.tsx")

    assert "autoFocus" not in source
    assert 'matchMedia("(hover: hover) and (pointer: fine)")' in source
    assert "focus({ preventScroll: true })" in source


def test_major_motion_surfaces_respect_reduced_motion() -> None:
    upload = read_frontend("components/upload/UploadDropzone.tsx")
    page_transition = read_frontend("components/layout/PageTransition.tsx")
    button = read_frontend("components/ui/Button.tsx")
    toggle = read_frontend("components/ui/Toggle.tsx")
    globals_css = read_frontend("styles/globals.css")

    assert "useReducedMotion" in upload
    assert "reduceMotion ? 1" in upload
    assert "initial={reduceMotion ? false" in upload
    assert "duration: reduceMotion ? 0" in upload
    assert "framer-motion" not in page_transition
    assert '"omnix-shell-page-enter min-h-0"' in page_transition
    assert ".omnix-shell-page-enter," in globals_css
    assert "motion-reduce:active:scale-100" in button
    assert "motion-reduce:hover:translate-y-0" in toggle
