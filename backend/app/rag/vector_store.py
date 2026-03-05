from __future__ import annotations

import json
import logging
import os

import numpy as np

from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)

try:
    import faiss
except ImportError:
    faiss = None
    logger.warning("faiss is not installed. Vector store will not function.")

EMBEDDING_DIMENSION = 384


class FAISSStore(VectorStore):
    """
    FAISS-based implementation of VectorStore using IndexFlatL2 for 384-dimensional embeddings.
    
    Maintains:
    - FAISS index: stores embedding vectors
    - index_to_id mapping: maps FAISS sequential indices to string chunk IDs
    - id_to_user mapping: maps chunk IDs to owning user IDs (for multi-tenant isolation)
    
    This is the concrete implementation. For other backends (pgvector, etc.),
    create a new class implementing the VectorStore interface.
    """

    def __init__(self) -> None:
        if faiss is None:
            raise RuntimeError("faiss library is required for the vector store.")
            
        self.index = faiss.IndexFlatL2(EMBEDDING_DIMENSION)
        # Maps the sequential FAISS index (integer) to the provided string ID
        self.index_to_id: list[str] = []
        # Maps the string ID to the owning user_id
        self.id_to_user: dict[str, str] = {}

    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str]) -> None:
        """
        Adds multiple embedding vectors to the FAISS index and stores their ID mappings.

        Args:
            embeddings (list[list[float]]): A list of 384-dimensional vectors.
            ids (list[str]): A list of string IDs corresponding to each vector.
            user_ids (list[str]): A list of string user_ids corresponding to each vector.
        """
        if not embeddings or not ids or not user_ids:
            return

        if len(embeddings) != len(ids) or len(embeddings) != len(user_ids):
            raise ValueError("The number of embeddings must match the number of IDs and user_ids.")

        # Convert to numpy array of float32, required by FAISS
        try:
            np_embeddings = np.array(embeddings, dtype=np.float32)
        except Exception as exc:
            raise ValueError("Failed to convert embeddings to a numpy array.") from exc

        if np_embeddings.shape[1] != EMBEDDING_DIMENSION:
            raise ValueError(
                f"Expected embedding dimension {EMBEDDING_DIMENSION}, "
                f"but got {np_embeddings.shape[1]}."
            )

        try:
            self.index.add(np_embeddings)
            self.index_to_id.extend(ids)
            for chunk_id, user_id in zip(ids, user_ids):
                self.id_to_user[chunk_id] = user_id
        except Exception as exc:
            logger.exception("Failed to add embeddings to FAISS index.")
            raise RuntimeError("Adding embeddings failed.") from exc

    def search(self, query_embedding: list[float], user_id: str, top_k: int = 5) -> list[tuple[str, float]]:
        """
        Searches the FAISS index for the most similar vectors to the query, 
        filtered by user_id before returning.

        Args:
            query_embedding (list[float]): The 384-dimensional query vector.
            user_id (str): The ID of the user requesting the search.
            top_k (int): The number of top results to return.

        Returns:
            list[tuple[str, float]]: A list of tuples containing (id, distance).
        """
        if not query_embedding:
            return []
            
        if self.index.ntotal == 0:
            return []

        try:
            np_query = np.array([query_embedding], dtype=np.float32)
        except Exception as exc:
            raise ValueError("Failed to convert query embedding to a numpy array.") from exc

        if np_query.shape[1] != EMBEDDING_DIMENSION:
            raise ValueError(
                f"Expected query dimension {EMBEDDING_DIMENSION}, "
                f"but got {np_query.shape[1]}."
            )

        # Dynamic search depth: scan deeper if we filter out non-owned results
        # Start by scanning top_k * 3, and increase if needed. For simplicity, we just use a multiplier.
        search_multiplier = 3
        current_top_k = min(top_k * search_multiplier, self.index.ntotal)
        
        # FAISS search returns distances (L2) and indices (integer positions)
        try:
            distances, indices = self.index.search(np_query, current_top_k)
        except Exception as exc:
            logger.exception("FAISS search failed.")
            raise RuntimeError("Similarity search failed.") from exc

        results: list[tuple[str, float]] = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1:
                continue
            
            try:
                string_id = self.index_to_id[idx]
                # Filter by user_id before returning
                if self.id_to_user.get(string_id) == user_id:
                    results.append((string_id, float(dist)))
                    if len(results) >= top_k:
                        break
            except IndexError:
                logger.error("FAISS index out of bounds in ID mapping for index %s", idx)
                continue
                
        return results

    def save_local(self, index_path: str, map_path: str) -> None:
        """
        Saves the FAISS index and the ID mappings to disk.

        Args:
            index_path (str): File path to save the FAISS index (.index file).
            map_path (str): File path to save the ID mapping (.json file).
        """
        try:
            faiss.write_index(self.index, index_path)
            with open(map_path, "w", encoding="utf-8") as f:
                json.dump({"index_to_id": self.index_to_id, "id_to_user": self.id_to_user}, f)
        except Exception as exc:
            logger.exception("Failed to save FAISS index locally.")
            raise RuntimeError("Saving FAISS index failed.") from exc

    def load_local(self, index_path: str, map_path: str) -> None:
        """
        Loads a FAISS index and its ID mappings from disk.

        Args:
            index_path (str): File path to the saved FAISS index.
            map_path (str): File path to the saved ID mapping.
        """
        if not os.path.exists(index_path) or not os.path.exists(map_path):
            raise FileNotFoundError("FAISS index or mapping file does not exist.")

        try:
            self.index = faiss.read_index(index_path)
            with open(map_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    # Legacy support: if map file was just a list
                    self.index_to_id = data
                    self.id_to_user = {}
                else:
                    self.index_to_id = data.get("index_to_id", [])
                    self.id_to_user = data.get("id_to_user", {})
        except Exception as exc:
            logger.exception("Failed to load FAISS index locally.")
            raise RuntimeError("Loading FAISS index failed.") from exc
            
        if self.index.ntotal != len(self.index_to_id):
            logger.warning(
                "FAISS index size (%d) does not match ID mapping size (%d).",
                self.index.ntotal,
                len(self.index_to_id),
            )
