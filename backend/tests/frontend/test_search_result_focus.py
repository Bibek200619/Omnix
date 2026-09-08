from __future__ import annotations

from pathlib import Path


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"


def read_frontend(relative_path: str) -> str:
    return (FRONTEND_ROOT / relative_path).read_text(encoding="utf-8")


def test_file_and_source_search_routes_prepare_and_focus_the_target() -> None:
    files_page = read_frontend("app/(dashboard)/files/page.tsx")
    focus_hook = read_frontend("components/files/useFileSearchFocus.ts")
    file_card = read_frontend("components/files/FileSourceCard.tsx")

    assert "useFileSearchFocus" in files_page
    assert "loadFilesWithSearchTarget(focusedFileId)" in files_page
    assert 'searchParams?.get("id")' in focus_hook
    assert 'searchParams?.get("source")' in focus_hook
    assert "`/files/${encodeURIComponent(focusedFileId)}`" in focus_hook
    assert 'setActiveSection("files")' in focus_hook
    assert 'setActiveSection("connectors")' in focus_hook
    assert "scrollIntoView" in focus_hook
    assert "node.focus({ preventScroll: true })" in focus_hook
    assert "prefers-reduced-motion: reduce" in focus_hook
    assert "data-search-focused" in file_card
    assert 'fileSearchFocusId("source", connector.id)' in files_page


def test_ranked_search_ui_does_not_reference_missing_destinations() -> None:
    search_service = (
        Path(__file__).resolve().parents[2]
        / "app"
        / "services"
        / "workspace_search_service.py"
    ).read_text(encoding="utf-8")

    assert '"/sources?source=' in search_service
    assert '"/automations?id=' not in search_service
    assert '"/workspace/activity?id=' not in search_service
