from __future__ import annotations

from abc import ABC, abstractmethod


class VectorStore(ABC):
    """
    Abstract interface for vector storage implementations.
    
    This interface defines the contract for all vector store implementations
    (FAISS, pgvector, etc.). It abstracts away the specific storage backend
    so that ingestion and retrieval logic can remain backend-agnostic.
    
    Future implementations can use pgvector, Pinecone, Weaviate, etc. without
    changing ingestion or retrieval code.
    """

    @abstractmethod
    def add_embeddings(
        self,
        embeddings: list[list[float]],
        ids: list[str],
        user_ids: list[str],
    ) -> None:
        """
        Add embedding vectors to the store with their associated IDs and owners.
        
        Args:
            embeddings (list[list[float]]): List of embedding vectors.
                                           Each vector must have consistent dimensionality.
            ids (list[str]): List of unique identifiers for each embedding.
                            Must match the length of embeddings.
            user_ids (list[str]): List of user IDs that own each embedding.
                                 Must match the length of embeddings.
                                 Used for multi-tenant isolation.
        
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
        top_k: int = 5,
    ) -> list[tuple[str, float]]:
        """
        Search for the most similar embeddings to a query vector.
        
        Results are filtered to only return embeddings owned by the specified user
        to enforce multi-tenant isolation.
        
        Args:
            query_embedding (list[float]): The query vector to search for.
                                          Must have same dimensionality as stored vectors.
            user_id (str): The user performing the search.
                          Only embeddings owned by this user are returned.
            top_k (int): Maximum number of results to return. Defaults to 5.
        
        Returns:
            list[tuple[str, float]]: List of (id, distance) tuples sorted by distance.
                                    Lower distance = more similar.
                                    Only contains embeddings owned by user_id.
        
        Raises:
            ValueError: If query_embedding has wrong dimensions.
            RuntimeError: If search operation fails.
        """
        pass

    @abstractmethod
    def save_local(self, index_path: str, map_path: str) -> None:
        """
        Persist the vector store to disk for later recovery.
        
        Args:
            index_path (str): File path where the vector index should be saved.
            map_path (str): File path where the ID/user mappings should be saved.
        
        Raises:
            RuntimeError: If persistence fails.
        """
        pass

    @abstractmethod
    def load_local(self, index_path: str, map_path: str) -> None:
        """
        Load a previously persisted vector store from disk.
        
        Args:
            index_path (str): File path where the vector index is stored.
            map_path (str): File path where the ID/user mappings are stored.
        
        Raises:
            FileNotFoundError: If either file doesn't exist.
            RuntimeError: If loading fails.
        """
        pass
