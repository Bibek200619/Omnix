from __future__ import annotations

from pathlib import Path


COMMAND_PALETTE = Path(__file__).resolve().parents[3] / "frontend/components/layout/CommandPalette.tsx"


def test_command_palette_uses_tabbable_results_and_labelled_search_input() -> None:
    source = COMMAND_PALETTE.read_text(encoding="utf-8")

    assert 'event.key === "Tab"' not in source
    assert "tabIndex={-1}" not in source
    assert 'aria-label="Search Omnix commands and workspace results"' in source
    assert 'name="command_palette_search"' in source


def test_command_palette_keeps_keyboard_activation_paths() -> None:
    source = COMMAND_PALETTE.read_text(encoding="utf-8")

    assert 'event.key === "Escape"' in source
    assert 'event.key === "ArrowDown"' in source
    assert 'event.key === "ArrowUp"' in source
    assert 'event.key === "Enter" && event.target === inputRef.current' in source
    assert "focusPaletteItem(nextIndex)" in source
