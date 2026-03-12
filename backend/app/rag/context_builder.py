from __future__ import annotations

from ..retrieval.context_builder import ContextBuilder as HybridContextBuilder
from ..retrieval.scoring import RetrievalResult


class ContextBuilder:
    """
    Backward-compatible wrapper around the hybrid retrieval context builder.
    """

    def __init__(self, max_chunks: int = 5) -> None:
        """
        Initializes the ContextBuilder.

        Args:
            max_chunks (int): The maximum number of context chunks to include in the prompt.
                              Defaults to 5.
        """
        self.max_chunks = max_chunks
        self._builder = HybridContextBuilder(max_chunks=max_chunks)

    def build_context(self, query: str, chunks: list[str]) -> str:
        """
        Combines retrieved text chunks and the user query into a cited prompt.

        Args:
            query (str): The user's question or prompt.
            chunks (list[str]): A list of relevant text chunks retrieved from the vector store.

        Returns:
            str: A formatted prompt string containing the instructions, context, and question.
        """
        results = [
            RetrievalResult(
                chunk_id=f"legacy-{index}",
                content=chunk,
                file_name="Retrieved Context",
                score=max(0.0, 1.0 - (index * 0.01)),
                sources={"legacy"},
            )
            for index, chunk in enumerate(chunks)
            if chunk and chunk.strip()
        ]
        built_context = self._builder.build(
            query,
            results,
            workspace_id=None,
        )
        return built_context.prompt
