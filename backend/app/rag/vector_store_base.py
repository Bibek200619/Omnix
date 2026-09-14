from __future__ import annotations

from abc import ABC, abstractmethod


class VectorStore(ABC):
    """
    Abstract interface for vector storage implementations.

    Extended to support workspace scoping so embeddings can be isolated
    by (user_id, workspace_id) pairs while preserving multi-tenant isolation.
    """

    @abstractmethod
    def add_embeddings(
        self,
        embeddings: list[list[float]],
        ids: list[str],
        user_ids: list[str],
        workspace_ids: list[str] | None = None,
    ) -> None:
        """
        Add embedding vectors to the store with their associated IDs, owners and workspace.

        Args:
            embeddings (list[list[float]]): List of embedding vectors.
            ids (list[str]): List of unique identifiers for each embedding.
            user_ids (list[str]): List of user IDs that own each embedding.
            workspace_ids (list[str] | None): Optional list of workspace IDs for each embedding.

        Raises:
            ValueError: If lengths don't match or embeddings have wrong dimensions.
            RuntimeError: If storage operation fails.
        """
        pass

    @abstractmethod
    def search(
        self,
        query_embedding: list[float],
        user_id: str,
        workspace_id: str | None = None,
        top_k: int = 3,
    ) -> list[tuple[str, float]]:
        """
        Search for the most similar embeddings to a query vector.

        Results are filtered to only return embeddings owned by the specified user
        and (optionally) limited to a workspace to support project-scoped retrieval.

        Args:
            query_embedding (list[float]): The query vector to search for.
            user_id (str): The user performing the search. Only embeddings owned by this user are returned.
            workspace_id (str | None): Optional workspace to narrow results to a project.
            top_k (int): Maximum number of results to return. Defaults to 3.

        Returns:
            list[tuple[str, float]]: List of (id, distance) tuples sorted by distance.
        """
        pass
