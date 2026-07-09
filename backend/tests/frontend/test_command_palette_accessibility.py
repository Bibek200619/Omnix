from __future__ import annotations

from pathlib import Path


COMMAND_PALETTE = Path(__file__).resolve().parents[3] / "frontend/components/layout/CommandPalette.tsx"
COMMAND_PALETTE_MODEL = COMMAND_PALETTE.parent / "command-palette" / "commandPaletteModel.ts"


def test_command_palette_uses_tabbable_results_and_labelled_search_input() -> None:
    source = COMMAND_PALETTE.read_text(encoding="utf-8")

    assert 'event.key === "Tab"' not in source
    assert "tabIndex={-1}" not in source
    assert 'aria-label="Search Omnix commands and workspace results"' in source
    assert 'aria-describedby="omnix-command-palette-status"' in source
    assert 'name="command_palette_search"' in source


def test_command_palette_keeps_keyboard_activation_paths() -> None:
    source = COMMAND_PALETTE.read_text(encoding="utf-8")

    assert 'event.key === "Escape"' in source
    assert 'event.key === "ArrowDown"' in source
    assert 'event.key === "ArrowUp"' in source
    assert 'event.key === "Enter" && event.target === inputRef.current' in source
    assert "focusPaletteItem(nextIndex)" in source


def test_command_palette_announces_search_status_changes() -> None:
    source = COMMAND_PALETTE.read_text(encoding="utf-8")
    announcement_hook = (
        COMMAND_PALETTE.parent / "command-palette" / "useCommandPaletteAnnouncement.ts"
    ).read_text(encoding="utf-8")

    assert "useCommandPaletteAnnouncement" in source
    assert 'id="omnix-command-palette-status"' in source
    assert 'role="status"' in source
    assert 'aria-live="polite"' in source
    assert 'aria-atomic="true"' in source
    assert 'className="sr-only"' in source
    assert "Searching workspace…" in announcement_hook
    assert "No command or workspace results" in announcement_hook
    assert "workspace result" in announcement_hook
    assert "quick action" in announcement_hook


def test_command_palette_extracts_static_search_model() -> None:
    source = COMMAND_PALETTE.read_text(encoding="utf-8")
    model = COMMAND_PALETTE_MODEL.read_text(encoding="utf-8")

    assert "commandPaletteModel" in source
    assert "const quickActions" not in source
    assert "const searchGroups" not in source
    assert "function searchResultItem" not in source
    assert "export const quickActions" in model
    assert "export const searchGroups" in model
    assert "export function searchResultItem" in model
    assert "export function hrefWithFreshCreateToken" in model
    assert len(source.splitlines()) <= 620
