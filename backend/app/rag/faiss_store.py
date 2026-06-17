from __future__ import annotations

import json
import logging
import os
from typing import Any

import numpy as np

from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embedding_dimension
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSION = get_expected_embedding_dimension()


def _import_faiss() -> Any:
    try:
        import faiss
    except ImportError as exc:
        raise RuntimeError("faiss library is required when OMNIX_VECTOR_BACKEND=faiss.") from exc
    return faiss


class FAISSStore(VectorStore):
    """
    Legacy FAISS implementation retained only for OMNIX_VECTOR_BACKEND=faiss.

    pgvector is the default durable backend. This adapter preserves the previous
    in-process FAISS behavior for explicit legacy deployments.
    """

    def __init__(self) -> None:
        self._faiss = _import_faiss()
        self.index = self._faiss.IndexFlatL2(EMBEDDING_DIMENSION)
        self.index_to_id: list[str] = []
        self.id_to_user: dict[str, str] = {}
        self.id_to_workspace: dict[str, str] = {}

    def add_embeddings(
        self,
        embeddings: list[list[float]],
        ids: list[str],
        user_ids: list[str],
        workspace_ids: list[str] | None = None,
    ) -> None:
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

        actual_dim = np_embeddings.shape[1] if np_embeddings.ndim == 2 else 0
        if actual_dim != EMBEDDING_DIMENSION:
            raise ValueError(f"Expected embedding dimension {EMBEDDING_DIMENSION}, but got {actual_dim}.")

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

    def search(
        self,
        query_embedding: list[float],
        user_id: str,
        workspace_id: str | list[str] | None = None,
        top_k: int = 5,
    ) -> list[tuple[str, float]]:
        if not query_embedding or self.index.ntotal == 0:
            return []

        try:
            validate_embedding_dimension(query_embedding, expected_dim=EMBEDDING_DIMENSION, label="query embedding")
            np_query = np.array([query_embedding], dtype=np.float32)
        except Exception as exc:
            raise ValueError("Failed to convert query embedding to a numpy array.") from exc

        search_count = min(max(1, top_k) * 3, self.index.ntotal)
        try:
            distances, indices = self.index.search(np_query, search_count)
        except Exception as exc:
            logger.exception("FAISS search failed.")
            raise RuntimeError("Similarity search failed.") from exc

        workspace_ids = _normalize_workspace_ids(workspace_id)
        results: list[tuple[str, float]] = []
        for dist, idx in zip(distances[0], indices[0]):
            if idx == -1:
                continue
            try:
                chunk_id = self.index_to_id[idx]
            except IndexError:
                logger.error("FAISS index out of bounds in ID mapping for index %s", idx)
                continue

            if workspace_ids:
                if self.id_to_workspace.get(chunk_id) not in workspace_ids:
                    continue
            elif self.id_to_user.get(chunk_id) != user_id:
                continue

            results.append((chunk_id, float(dist)))
            if len(results) >= top_k:
                break

        return results

    def save_local(self, index_path: str, map_path: str) -> None:
        try:
            self._faiss.write_index(self.index, index_path)
            with open(map_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "index_to_id": self.index_to_id,
                        "id_to_user": self.id_to_user,
                        "id_to_workspace": self.id_to_workspace,
                    },
                    f,
                )
        except Exception as exc:
            logger.exception("Failed to save FAISS index locally.")
            raise RuntimeError("Saving FAISS index failed.") from exc

    def load_local(self, index_path: str, map_path: str) -> None:
        if not os.path.exists(index_path) or not os.path.exists(map_path):
            raise FileNotFoundError("FAISS index or mapping file does not exist.")

        try:
            self.index = self._faiss.read_index(index_path)
            with open(map_path, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception as exc:
            logger.exception("Failed to load FAISS index locally.")
            raise RuntimeError("Loading FAISS index failed.") from exc

        if isinstance(data, list):
            self.index_to_id = data
            self.id_to_user = {}
            self.id_to_workspace = {}
        else:
            self.index_to_id = data.get("index_to_id", [])
            self.id_to_user = data.get("id_to_user", {})
            self.id_to_workspace = data.get("id_to_workspace", {})

        if self.index.ntotal != len(self.index_to_id):
            logger.warning(
                "FAISS index size (%d) does not match ID mapping size (%d).",
                self.index.ntotal,
                len(self.index_to_id),
            )


def _normalize_workspace_ids(workspace_id: str | list[str] | None) -> set[str]:
    if workspace_id is None:
        return set()
    if isinstance(workspace_id, list):
        return {str(value) for value in workspace_id if value}
    return {str(workspace_id)}
