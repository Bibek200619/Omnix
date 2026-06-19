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


if __name__ == "__main__":
    test_query_analysis_favors_keywords_for_ids_and_filenames()
    test_query_analysis_favors_semantic_for_conceptual_questions()
    test_merge_results_normalizes_scores_and_deduplicates_chunks()
    test_context_builder_preserves_citations_and_workspace_boundaries()
    test_hybrid_engine_runs_semantic_keyword_fusion_and_reranking()
    print("Hybrid retrieval tests passed.")
