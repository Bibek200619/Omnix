from __future__ import annotations

import sys
import types

import pytest

from backend.app.services import document_intelligence_service as svc


class _TextPage:
    def __init__(self, text: str) -> None:
        self.text = text

    def extract_text(self) -> str:
        return self.text

    def get(self, key: str):
        return {} if key == "/Resources" else None


class _ImageObject:
    def get_object(self):
        return self

    def get(self, key: str):
        return "/Image" if key == "/Subtype" else None


class _ImagePage:
    def extract_text(self) -> str:
        return ""

    def get(self, key: str):
        if key != "/Resources":
            return None
        return {"/XObject": {"img": _ImageObject()}}


def _install_fake_pypdf(monkeypatch: pytest.MonkeyPatch, pages: list[object]) -> None:
    module = types.ModuleType("pypdf")

    class PdfReader:
        def __init__(self, _stream) -> None:
            self.pages = pages

    module.PdfReader = PdfReader
    monkeypatch.setitem(sys.modules, "pypdf", module)


def test_normal_text_pdf_is_searchable(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_pypdf(monkeypatch, [_TextPage("Quarterly roadmap has searchable text.")])

    result = svc.extract_document_with_diagnostics("roadmap.pdf", "application/pdf", b"%PDF")

    assert result.text == "Quarterly roadmap has searchable text."
    assert result.diagnostics.page_count == 1
    assert result.diagnostics.extractor_used == "pypdf"
    assert result.diagnostics.extraction_status == "searchable"
    assert result.diagnostics.extracted_character_count > 20
    assert result.diagnostics.text_page_count == 1


def test_image_only_pdf_is_ocr_required_when_ocr_disabled(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_pypdf(monkeypatch, [_ImagePage()])
    monkeypatch.setattr(svc, "OCR_ENABLED", False)

    result = svc.extract_document_with_diagnostics("scan.pdf", "application/pdf", b"%PDF")

    assert result.text == ""
    assert result.diagnostics.page_count == 1
    assert result.diagnostics.image_page_count == 1
    assert result.diagnostics.text_page_count == 0
    assert result.diagnostics.extraction_status == "ocr_required"
    assert "no readable text layer" in (result.diagnostics.extraction_failure_reason or "")


def test_ocr_success_path_becomes_searchable(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_pypdf(monkeypatch, [_ImagePage()])
    monkeypatch.setattr(svc, "OCR_ENABLED", True)
    monkeypatch.setattr(svc, "_ocr_pdf", lambda _data, _page_count: ("OCR extracted contract terms and obligations.", None))

    result = svc.extract_document_with_diagnostics("scan.pdf", "application/pdf", b"%PDF")

    assert result.text == "OCR extracted contract terms and obligations."
    assert result.diagnostics.extraction_status == "searchable"
    assert result.diagnostics.ocr_used is True
    assert result.diagnostics.ocr_character_count > 20


def test_document_likely_requires_ocr_for_image_only_pdf(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_pypdf(monkeypatch, [_ImagePage()])
    monkeypatch.setattr(svc, "OCR_ENABLED", True)

    assert svc.document_likely_requires_ocr("scan.pdf", "application/pdf", b"%PDF") is True


def test_ocr_failure_path_records_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_pypdf(monkeypatch, [_ImagePage()])
    monkeypatch.setattr(svc, "OCR_ENABLED", True)
    monkeypatch.setattr(svc, "_ocr_pdf", lambda _data, _page_count: (None, "Tesseract executable is unavailable."))

    result = svc.extract_document_with_diagnostics("scan.pdf", "application/pdf", b"%PDF")

    assert result.text == ""
    assert result.diagnostics.extraction_status == "extraction_failed"
    assert result.diagnostics.extraction_failure_reason == "Tesseract executable is unavailable."


def test_diagnostics_persistence_payload_contains_required_fields() -> None:
    diagnostics = svc.ExtractionDiagnostics(
        page_count=2,
        extractor_used="pypdf",
        extracted_character_count=42,
        image_page_count=1,
        text_page_count=1,
        extraction_status="searchable",
        ocr_used=True,
        ocr_character_count=24,
    )

    payload = svc.extraction_columns_payload(diagnostics)

    assert payload == {
        "page_count": 2,
        "extractor_used": "pypdf",
        "extracted_character_count": 42,
        "image_page_count": 1,
        "text_page_count": 1,
        "extraction_status": "searchable",
        "extraction_failure_reason": None,
        "ocr_used": True,
        "ocr_character_count": 24,
    }


def test_legacy_file_without_diagnostics_remains_searchable() -> None:
    diagnostics = svc.diagnostics_from_file({"id": "legacy-file", "metadata": {}})

    assert diagnostics.extraction_status == "searchable"
