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

    Maintains FAISS index and mapping structures that now include workspace scoping:
    - index_to_id: maps FAISS sequential indices to string chunk IDs
    - id_to_user: maps chunk IDs to owning user IDs
    - id_to_workspace: maps chunk IDs to workspace IDs (optional)
    """

    def __init__(self) -> None:
        if faiss is None:
            raise RuntimeError("faiss library is required for the vector store.")

        self.index = faiss.IndexFlatL2(EMBEDDING_DIMENSION)
        self.index_to_id: list[str] = []
        self.id_to_user: dict[str, str] = {}
        self.id_to_workspace: dict[str, str] = {}

    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str], workspace_ids: list[str] | None = None) -> None:
        """
        Adds multiple embedding vectors to the FAISS index and stores their ID mappings.

        workspace_ids may be None (no workspace) or a list matching the length of embeddings.
        """
        if not embeddings or not ids or not user_ids:
            return

        n = len(embeddings)
        if len(ids) != n or len(user_ids) != n:
            raise ValueError("The number of embeddings must match the number of IDs and user_ids.")

        if workspace_ids is not None and len(workspace_ids) != n:
            raise ValueError("workspace_ids must match the length of embeddings when provided.")

        try:
            np_embeddings = np.array(embeddings, dtype=np.float32)
        except Exception as exc:
            raise ValueError("Failed to convert embeddings to a numpy array.") from exc

        if np_embeddings.shape[1] != EMBEDDING_DIMENSION:
            raise ValueError(
                f"Expected embedding dimension {EMBEDDING_DIMENSION}, but got {np_embeddings.shape[1]}."
            )

        try:
            self.index.add(np_embeddings)
            self.index_to_id.extend(ids)
            for chunk_id, user_id, workspace_id in zip(ids, user_ids, workspace_ids or [None] * n):
                self.id_to_user[chunk_id] = user_id
                if workspace_id:
                    self.id_to_workspace[chunk_id] = workspace_id
        except Exception as exc:
            logger.exception("Failed to add embeddings to FAISS index.")
            raise RuntimeError("Adding embeddings failed.") from exc

    def search(self, query_embedding: list[float], user_id: str, workspace_id: str | None = None, top_k: int = 5) -> list[tuple[str, float]]:
        """
        Searches the FAISS index for the most similar vectors to the query,
        filtered by user_id and optional workspace_id before returning.
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
                f"Expected query dimension {EMBEDDING_DIMENSION}, but got {np_query.shape[1]}."
            )

        search_multiplier = 3
        current_top_k = min(top_k * search_multiplier, self.index.ntotal)

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
                # Workspace searches are shared across all members of that workspace.
                if workspace_id is not None:
                    if self.id_to_workspace.get(string_id) != workspace_id:
                        continue
                elif self.id_to_user.get(string_id) != user_id:
                    continue

                results.append((string_id, float(dist)))
                if len(results) >= top_k:
                    break
            except IndexError:
                logger.error("FAISS index out of bounds in ID mapping for index %s", idx)
                continue

        return results

    def save_local(self, index_path: str, map_path: str) -> None:
        try:
            faiss.write_index(self.index, index_path)
            with open(map_path, "w", encoding="utf-8") as f:
                json.dump({
                    "index_to_id": self.index_to_id,
                    "id_to_user": self.id_to_user,
                    "id_to_workspace": self.id_to_workspace,
                }, f)
        except Exception as exc:
            logger.exception("Failed to save FAISS index locally.")
            raise RuntimeError("Saving FAISS index failed.") from exc

    def load_local(self, index_path: str, map_path: str) -> None:
        if not os.path.exists(index_path) or not os.path.exists(map_path):
            raise FileNotFoundError("FAISS index or mapping file does not exist.")

        try:
            self.index = faiss.read_index(index_path)
            with open(map_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                if isinstance(data, list):
                    self.index_to_id = data
                    self.id_to_user = {}
                    self.id_to_workspace = {}
                else:
                    self.index_to_id = data.get("index_to_id", [])
                    self.id_to_user = data.get("id_to_user", {})
                    self.id_to_workspace = data.get("id_to_workspace", {})
        except Exception as exc:
            logger.exception("Failed to load FAISS index locally.")
            raise RuntimeError("Loading FAISS index failed.") from exc

        if self.index.ntotal != len(self.index_to_id):
            logger.warning(
                "FAISS index size (%d) does not match ID mapping size (%d).",
                self.index.ntotal,
                len(self.index_to_id),
            )
