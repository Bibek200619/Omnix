from __future__ import annotations

import asyncio

from backend.app.retrieval.context_builder import ContextBuilder
from backend.app.retrieval.hybrid_search import HybridSearchConfig, HybridSearchEngine
from backend.app.retrieval.scoring import RetrievalResult, analyze_query


def _result(
    chunk_id: str,
    content: str,
    *,
    workspace_id: str | None = "workspace-a",
    file_id: str = "file-a",
    file_name: str = "notes.md",
    semantic_score: float = 0.0,
    keyword_score: float = 0.0,
    source: str = "semantic",
) -> RetrievalResult:
    return RetrievalResult(
        chunk_id=chunk_id,
        content=content,
        file_id=file_id,
        file_name=file_name,
        workspace_id=workspace_id,
        semantic_score=semantic_score,
        keyword_score=keyword_score,
        sources={source},
    )


def test_query_analysis_favors_keywords_for_ids_and_filenames() -> None:
    id_query = analyze_query("ERR-42 auth_timeout")
    assert id_query.keyword_weight > id_query.semantic_weight
    assert id_query.is_technical

    filename_query = analyze_query("open roadmap-v2.pdf")
    assert filename_query.keyword_weight >= 0.75
    assert filename_query.is_filename_lookup


def test_query_analysis_favors_semantic_for_conceptual_questions() -> None:
    analysis = analyze_query("How should we think about retention trends across onboarding notes?")
    assert analysis.semantic_weight > analysis.keyword_weight
    assert analysis.is_semantic


def test_merge_results_normalizes_scores_and_deduplicates_chunks() -> None:
    semantic = [
        _result("chunk-1", "OAuth token refresh fails for ERR-42.", semantic_score=0.9),
        _result("chunk-2", "General auth architecture notes.", semantic_score=0.45),
    ]
    keyword = [
        _result("chunk-1", "OAuth token refresh fails for ERR-42.", keyword_score=4.0, source="keyword"),
        _result("chunk-3", "ERR-42 appears in the incident log.", keyword_score=2.0, source="keyword"),
    ]

    merged = HybridSearchEngine._merge_results(
        semantic,
        keyword,
        semantic_weight=0.4,
        keyword_weight=0.6,
    )

    by_id = {result.chunk_id: result for result in merged}
    assert set(by_id) == {"chunk-1", "chunk-2", "chunk-3"}
    assert by_id["chunk-1"].sources == {"semantic", "keyword"}
    assert by_id["chunk-1"].score > by_id["chunk-2"].score
    assert by_id["chunk-1"].score > by_id["chunk-3"].score


def test_context_builder_preserves_citations_and_workspace_boundaries() -> None:
    builder = ContextBuilder(max_chunks=3, token_budget=180, max_chunk_tokens=80)
    results = [
        _result("chunk-1", "Workspace A launch plan with API-100 details.", workspace_id="workspace-a"),
        _result("chunk-2", "Workspace B private plan that must not leak.", workspace_id="workspace-b"),
        _result("chunk-3", "Workspace A launch plan with API-100 details.", workspace_id="workspace-a"),
    ]

    built = builder.build("API-100", results, workspace_id="workspace-a")

    assert len(built.sources) == 1
    assert built.sources[0]["label"] == "S1"
    assert "Workspace B private" not in built.prompt
    assert "Workspace A launch plan" in built.prompt
    assert built.sources[0]["id"] == "chunk-1"


def test_hybrid_engine_runs_semantic_keyword_fusion_and_reranking() -> None:
    class FakeSemanticSearch:
        async def search(self, *args, **kwargs):
            return [_result("chunk-1", "OAuth token refresh fails for ERR-42.", semantic_score=0.8)]

    class FakeKeywordSearch:
        async def search(self, *args, **kwargs):
            return [_result("chunk-1", "OAuth token refresh fails for ERR-42.", keyword_score=6.0, source="keyword")]

    engine = HybridSearchEngine(
        semantic_search=FakeSemanticSearch(),
        keyword_search=FakeKeywordSearch(),
        config=HybridSearchConfig(
            top_k=3,
            semantic_pool_size=3,
            keyword_pool_size=3,
            semantic_weight=0.7,
            keyword_weight=0.3,
            dev_diagnostics=False,
        ),
    )

    response = asyncio.run(engine.search("ERR-42", user_id="user-a", workspace_id="workspace-a"))

    assert len(response.results) == 1
    assert response.results[0].sources == {"semantic", "keyword"}
    assert response.diagnostics["semantic_matches"] == 1
    assert response.diagnostics["keyword_matches"] == 1


def test_hybrid_engine_marks_vector_channel_failure_as_partial_without_error_text() -> None:
    class FailingSemanticSearch:
        async def search(self, *args, **kwargs):
            raise RuntimeError("vector endpoint secret: should not reach diagnostics")

    class WorkingKeywordSearch:
        async def search(self, *args, **kwargs):
            return [_result("chunk-keyword", "Keyword fallback found this evidence.", keyword_score=1.0, source="keyword")]

    engine = HybridSearchEngine(
        semantic_search=FailingSemanticSearch(),
        keyword_search=WorkingKeywordSearch(),
        config=HybridSearchConfig(dev_diagnostics=False, channel_timeout_seconds=0.1),
    )

    response = asyncio.run(engine.search("evidence", user_id="user-a", workspace_id="workspace-a"))

    retrieval = response.diagnostics["retrieval"]
    assert [result.chunk_id for result in response.results] == ["chunk-keyword"]
    assert retrieval["outcome"] == "partial"
    assert retrieval["failed_channels"] == ["semantic"]
    assert retrieval["channels"]["semantic"]["status"] == "failed"
    assert retrieval["channels"]["semantic"]["error_code"] == "unexpected_error"
    assert "secret" not in str(retrieval)


def test_hybrid_engine_marks_keyword_channel_failure_as_partial() -> None:
    class WorkingSemanticSearch:
        async def search(self, *args, **kwargs):
            return [_result("chunk-semantic", "Semantic evidence remains available.", semantic_score=0.8)]

    class FailingKeywordSearch:
        async def search(self, *args, **kwargs):
            raise RuntimeError("keyword database unavailable")

    engine = HybridSearchEngine(
        semantic_search=WorkingSemanticSearch(),
        keyword_search=FailingKeywordSearch(),
        config=HybridSearchConfig(dev_diagnostics=False, channel_timeout_seconds=0.1),
    )

    response = asyncio.run(engine.search("evidence", user_id="user-a", workspace_id="workspace-a"))

    retrieval = response.diagnostics["retrieval"]
    assert [result.chunk_id for result in response.results] == ["chunk-semantic"]
    assert retrieval["outcome"] == "partial"
    assert retrieval["failed_channels"] == ["keyword"]
    assert retrieval["channels"]["keyword"]["status"] == "failed"


def test_hybrid_engine_marks_all_channel_failures_as_failed() -> None:
    class FailingSearch:
        async def search(self, *args, **kwargs):
            raise RuntimeError("provider unavailable")

    engine = HybridSearchEngine(
        semantic_search=FailingSearch(),
        keyword_search=FailingSearch(),
        config=HybridSearchConfig(dev_diagnostics=False, channel_timeout_seconds=0.1),
    )

    response = asyncio.run(engine.search("evidence", user_id="user-a", workspace_id="workspace-a"))

    retrieval = response.diagnostics["retrieval"]
    assert response.results == []
    assert retrieval["outcome"] == "failed"
    assert retrieval["failed_channels"] == ["semantic", "keyword"]
    assert all(channel["status"] == "failed" for channel in retrieval["channels"].values())


def test_hybrid_engine_marks_timed_out_channel_as_partial() -> None:
    class SlowSemanticSearch:
        async def search(self, *args, **kwargs):
            await asyncio.sleep(1)
            return []

    class WorkingKeywordSearch:
        async def search(self, *args, **kwargs):
            return [_result("chunk-keyword", "Keyword result after semantic timeout.", keyword_score=1.0, source="keyword")]

    engine = HybridSearchEngine(
        semantic_search=SlowSemanticSearch(),
        keyword_search=WorkingKeywordSearch(),
        config=HybridSearchConfig(dev_diagnostics=False, channel_timeout_seconds=0.01),
    )

    response = asyncio.run(engine.search("evidence", user_id="user-a", workspace_id="workspace-a"))

    retrieval = response.diagnostics["retrieval"]
    assert retrieval["outcome"] == "partial"
    assert retrieval["reason"] == "channel_timeout"
    assert retrieval["channels"]["semantic"]["status"] == "timed_out"
    assert retrieval["channels"]["semantic"]["error_code"] == "timeout"


def test_hybrid_engine_distinguishes_empty_context_from_failure() -> None:
    class EmptySearch:
        async def search(self, *args, **kwargs):
            return []

    engine = HybridSearchEngine(
        semantic_search=EmptySearch(),
        keyword_search=EmptySearch(),
        config=HybridSearchConfig(dev_diagnostics=False, channel_timeout_seconds=0.1),
    )

    response = asyncio.run(engine.search("evidence", user_id="user-a", workspace_id="workspace-a"))

    retrieval = response.diagnostics["retrieval"]
    assert response.results == []
    assert retrieval["outcome"] == "no_relevant_sources"
    assert retrieval["reason"] == "no_matches"
    assert retrieval["failed_channels"] == []
    assert retrieval["channels"]["semantic"]["status"] == "empty"
    assert retrieval["channels"]["keyword"]["status"] == "empty"


if __name__ == "__main__":
    test_query_analysis_favors_keywords_for_ids_and_filenames()
    test_query_analysis_favors_semantic_for_conceptual_questions()
    test_merge_results_normalizes_scores_and_deduplicates_chunks()
    test_context_builder_preserves_citations_and_workspace_boundaries()
    test_hybrid_engine_runs_semantic_keyword_fusion_and_reranking()
    print("Hybrid retrieval tests passed.")
