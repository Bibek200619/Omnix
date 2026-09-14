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


def _install_fake_ocr_runtime(monkeypatch: pytest.MonkeyPatch, page_count: int) -> list[int]:
    rendered_pages: list[int] = []
    pdfium = types.ModuleType("pypdfium2")
    tesseract = types.ModuleType("pytesseract")

    class Bitmap:
        def to_pil(self) -> object:
            return object()

    class Page:
        def __init__(self, index: int) -> None:
            self.index = index

        def render(self, *, scale: int) -> Bitmap:
            assert scale == 2
            rendered_pages.append(self.index)
            return Bitmap()

    class PdfDocument:
        def __init__(self, _data: bytes) -> None:
            self.pages = [Page(index) for index in range(page_count)]

        def __len__(self) -> int:
            return len(self.pages)

        def __getitem__(self, index: int) -> Page:
            return self.pages[index]

    pdfium.PdfDocument = PdfDocument
    tesseract.image_to_string = lambda _image: "OCR text from a page."
    monkeypatch.setitem(sys.modules, "pypdfium2", pdfium)
    monkeypatch.setitem(sys.modules, "pytesseract", tesseract)
    return rendered_pages


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
    monkeypatch.setattr(
        svc,
        "_ocr_pdf",
        lambda _data, _page_count: ("OCR extracted contract terms and obligations.", None, 1),
    )

    result = svc.extract_document_with_diagnostics("scan.pdf", "application/pdf", b"%PDF")

    assert result.text == "OCR extracted contract terms and obligations."
    assert result.diagnostics.extraction_status == "searchable"
    assert result.diagnostics.ocr_used is True
    assert result.diagnostics.ocr_character_count > 20
    assert result.diagnostics.ocr_pages_processed == 1
    assert result.diagnostics.ocr_pages_omitted == 0
    assert result.diagnostics.ocr_coverage_complete is True


def test_ocr_records_bounded_page_coverage_in_metadata(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_pypdf(monkeypatch, [_ImagePage(), _ImagePage(), _ImagePage()])
    monkeypatch.setattr(svc, "OCR_ENABLED", True)
    monkeypatch.setattr(svc, "MAX_OCR_PAGES", 2)
    monkeypatch.setattr(
        svc,
        "_ocr_pdf",
        lambda _data, _page_count: ("OCR extracted contract terms and obligations.", None, 2),
    )

    result = svc.extract_document_with_diagnostics("scan.pdf", "application/pdf", b"%PDF")

    assert result.diagnostics.extraction_status == "searchable"
    assert result.diagnostics.ocr_pages_processed == 2
    assert result.diagnostics.ocr_pages_omitted == 1
    assert result.diagnostics.ocr_coverage_complete is False
    assert result.diagnostics.to_metadata() == {
        "page_count": 3,
        "extractor_used": "pypdf",
        "extracted_character_count": 0,
        "image_page_count": 3,
        "text_page_count": 0,
        "extraction_status": "searchable",
        "extraction_failure_reason": None,
        "ocr_used": True,
        "ocr_character_count": len("OCR extracted contract terms and obligations."),
        "ocr_pages_processed": 2,
        "ocr_pages_omitted": 1,
        "ocr_coverage_complete": False,
    }
    restored = svc.diagnostics_from_file({"metadata": result.diagnostics.to_metadata()})
    assert restored.ocr_pages_processed == 2
    assert restored.ocr_pages_omitted == 1
    assert restored.ocr_coverage_complete is False


def test_ocr_pdf_processes_only_configured_page_limit(monkeypatch: pytest.MonkeyPatch) -> None:
    rendered_pages = _install_fake_ocr_runtime(monkeypatch, page_count=3)
    monkeypatch.setattr(svc, "MAX_OCR_PAGES", 2)

    text, error, pages_processed = svc._ocr_pdf(b"%PDF", page_count=3)

    assert text == "OCR text from a page.\n\nOCR text from a page."
    assert error is None
    assert pages_processed == 2
    assert rendered_pages == [0, 1]


def test_document_likely_requires_ocr_for_image_only_pdf(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_pypdf(monkeypatch, [_ImagePage()])
    monkeypatch.setattr(svc, "OCR_ENABLED", True)

    assert svc.document_likely_requires_ocr("scan.pdf", "application/pdf", b"%PDF") is True


def test_ocr_failure_path_records_failure(monkeypatch: pytest.MonkeyPatch) -> None:
    _install_fake_pypdf(monkeypatch, [_ImagePage()])
    monkeypatch.setattr(svc, "OCR_ENABLED", True)
    monkeypatch.setattr(svc, "_ocr_pdf", lambda _data, _page_count: (None, "Tesseract executable is unavailable.", 0))

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
        ocr_pages_processed=2,
        ocr_pages_omitted=0,
        ocr_coverage_complete=True,
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
    assert "ocr_pages_processed" not in payload
    assert "ocr_pages_omitted" not in payload
    assert "ocr_coverage_complete" not in payload


def test_legacy_file_without_diagnostics_remains_searchable() -> None:
    diagnostics = svc.diagnostics_from_file({"id": "legacy-file", "metadata": {}})

    assert diagnostics.extraction_status == "searchable"
