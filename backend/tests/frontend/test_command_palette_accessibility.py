from __future__ import annotations

from pathlib import Path


COMMAND_PALETTE = Path(__file__).resolve().parents[3] / "frontend/components/layout/CommandPalette.tsx"
COMMAND_PALETTE_ITEM = COMMAND_PALETTE.parent / "command-palette" / "CommandPaletteItem.tsx"
COMMAND_PALETTE_MODEL = COMMAND_PALETTE.parent / "command-palette" / "commandPaletteModel.ts"
FOCUS_TRAP = Path(__file__).resolve().parents[3] / "frontend/lib/use-focus-trap.ts"


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


def test_command_palette_extracts_accessible_result_item() -> None:
    source = COMMAND_PALETTE.read_text(encoding="utf-8")
    item = COMMAND_PALETTE_ITEM.read_text(encoding="utf-8")

    assert "CommandPaletteItem" in source
    assert "setItemRef={(node)" in source
    assert "onActiveChange={() => setActiveIndex(index)}" in source
    assert "onActivate={() => selectItem(item)}" in source
    assert "export function CommandPaletteItem" in item
    assert 'type="button"' in item
    assert "aria-current={active ? \"true\" : undefined}" in item
    assert "aria-label={`${item.label}. ${item.description}`}" in item
    assert "focus-visible:ring-2" in item
    assert "onFocus={onActiveChange}" in item


def test_command_palette_uses_focus_trap_initial_target_without_competing_timer() -> None:
    source = COMMAND_PALETTE.read_text(encoding="utf-8")
    focus_trap = FOCUS_TRAP.read_text(encoding="utf-8")

    assert (
        "useFocusTrap<HTMLDivElement>(open, inputRef, { isolateBackground: true })"
        in source
    )
    assert "setTimeout(() => inputRef.current?.focus()" not in source
    assert "initialFocusRef?: RefObject<HTMLElement | null>" in focus_trap
    assert "const preferred = initialFocusRef?.current" in focus_trap
    assert "container.contains(preferred)" in focus_trap
    assert "(first ?? container).focus" in focus_trap
