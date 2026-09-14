from __future__ import annotations

from pathlib import Path


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"
LANDING = FRONTEND_ROOT / "components" / "landing" / "LandingExperience.tsx"
PRIMITIVES = FRONTEND_ROOT / "components" / "landing" / "LandingPrimitives.tsx"
APP_SCREENSHOTS = FRONTEND_ROOT / "components" / "landing" / "LandingAppScreenshots.tsx"


def test_landing_experience_delegates_primitives_and_app_tour() -> None:
    landing = LANDING.read_text(encoding="utf-8")
    primitives = PRIMITIVES.read_text(encoding="utf-8")
    app_screenshots = APP_SCREENSHOTS.read_text(encoding="utf-8")

    assert 'from "@/components/landing/LandingPrimitives"' in landing
    assert 'from "@/components/landing/LandingAppScreenshots"' in landing
    assert "export const C" in primitives
    assert "export const ICONS" in primitives
    assert "export function Sec" in primitives
    assert "export function AppScreenshots" in app_screenshots
    assert "function AppScreenshots" not in landing


def test_landing_modules_stay_below_reviewable_size_thresholds() -> None:
    assert len(LANDING.read_text(encoding="utf-8").splitlines()) <= 1_000
    assert len(PRIMITIVES.read_text(encoding="utf-8").splitlines()) <= 320
    assert len(APP_SCREENSHOTS.read_text(encoding="utf-8").splitlines()) <= 280
