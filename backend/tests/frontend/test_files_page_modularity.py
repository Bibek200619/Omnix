from __future__ import annotations

from pathlib import Path


FRONTEND_ROOT = Path(__file__).resolve().parents[3] / "frontend"
FILES_PAGE = FRONTEND_ROOT / "app" / "(dashboard)" / "files" / "page.tsx"
FILES_MODEL = FRONTEND_ROOT / "components" / "files" / "filesPageModel.ts"
CONNECTOR_SETUP_MODAL = FRONTEND_ROOT / "components" / "files" / "ConnectorSetupModal.tsx"
DOCUMENT_PORTAL = FRONTEND_ROOT / "components" / "files" / "DocumentPortal.tsx"
CHAT_TYPES = FRONTEND_ROOT / "components" / "chat" / "types.ts"
SOURCE_HEALTH_CONSOLE = FRONTEND_ROOT / "components" / "files" / "SourceHealthConsole.tsx"


def test_files_page_delegates_pure_model_helpers() -> None:
    page = FILES_PAGE.read_text(encoding="utf-8")
    model = FILES_MODEL.read_text(encoding="utf-8")
    modal = CONNECTOR_SETUP_MODAL.read_text(encoding="utf-8")
    portal = DOCUMENT_PORTAL.read_text(encoding="utf-8")

    assert 'from "@/components/files/filesPageModel"' in page
    assert 'from "@/components/files/ConnectorSetupModal"' in page
    assert 'from "@/components/files/DocumentPortal"' in page
    assert "function fileIngestionStatus" not in page
    assert "function connectorSummary" not in page
    assert "function ConnectorUrlField" not in page
    assert "const sourceTypes" not in page
    assert "type ConnectorStatus" not in page

    assert "export interface FileData" in model
    assert "export type WorkspaceConnector" in model
    assert "export const sourceTypes" in model
    assert "export function fileIngestionStatus" in model
    assert "export function connectorSummary" in model
    assert "export function ConnectorSetupModal" in modal
    assert "export function DocumentPortal" in portal


def test_files_page_stays_below_reviewable_size_threshold() -> None:
    page_lines = FILES_PAGE.read_text(encoding="utf-8").splitlines()
    model_lines = FILES_MODEL.read_text(encoding="utf-8").splitlines()
    modal_lines = CONNECTOR_SETUP_MODAL.read_text(encoding="utf-8").splitlines()

    assert len(page_lines) <= 900
    assert len(model_lines) <= 450
    assert len(modal_lines) <= 350


def test_file_processing_states_distinguish_indexing_from_partial_searchability() -> None:
    model = FILES_MODEL.read_text(encoding="utf-8")
    chat_types = CHAT_TYPES.read_text(encoding="utf-8")
    source_health = SOURCE_HEALTH_CONSOLE.read_text(encoding="utf-8")

    for status in ("extracting", "chunking", "embedding", "partially_searchable", "ocr_running"):
        assert f'"{status}"' in model
        assert f'"{status}"' in chat_types

    assert "function isFileIngestionStatus" in model
    assert "vector indexing is incomplete" in model
    assert '"partially_searchable"' in source_health
