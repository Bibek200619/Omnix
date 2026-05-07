from __future__ import annotations

import logging
from typing import Any

from ..core.config import get_settings
from ..embeddings.dimensions import get_expected_embedding_dimension, validate_embedding_dimension
from ..services.supabase_service import SupabaseServiceError, select_all, select_all_trusted
from .embedding import get_embedding
from .vector_store_base import VectorStore

logger = logging.getLogger(__name__)


class RAGRetriever:
    """
    Coordinates the similarity search process for the RAG system.
    Backend-agnostic: works with any VectorStore implementation.

    Flow: Query embedding → search vector store → fetch chunks from Supabase → return chunks
    """

    def __init__(self, vector_store: VectorStore) -> None:
        if not isinstance(vector_store, VectorStore):
            raise TypeError("vector_store must be an instance of VectorStore.")

        self.vector_store = vector_store

    async def retrieve(self, query: str, user_id: str, workspace_id: str | None = None, top_k: int = 5, distance_threshold: float | None = None) -> list[dict[str, Any]]:
        """
        Retrieves the most relevant text chunks for a given query securely from the database.

        Args:
            query (str): The search query.
            user_id (str): The ID of the user requesting the search.
            workspace_id (str | None): Optional workspace to scope retrieval.
            top_k (int): The maximum number of chunks to return. Defaults to 5.
            distance_threshold (float | None): The maximum vector distance for a chunk to be considered relevant.

        Returns:
            list[dict]: Relevant chunk records with metadata.
        """
        if not query or not query.strip():
            logger.warning("Empty query provided to retriever. Skipping search.")
            return []
        if not user_id:
            raise ValueError("user_id is required to securely retrieve chunks.")

        if distance_threshold is None:
            distance_threshold = get_settings().SIMILARITY_THRESHOLD

        logger.info("Generating local embedding for query.")
        try:
            query_embedding = await get_embedding(query)
        except Exception as exc:
            logger.exception("Failed to generate query embedding.")
            query_embedding = []

        if not query_embedding:
            logger.warning("Embedding generation returned an empty vector.")
            return []
        try:
            validate_embedding_dimension(
                query_embedding,
                expected_dim=get_expected_embedding_dimension(),
                label="query embedding",
            )
        except ValueError:
            logger.exception("Query embedding dimension does not match the vector store contract.")
            return []

        search_results: list[tuple[str, float]] = []
        try:
            logger.info("Starting semantic vector search for top %d matches.", top_k)
            search_results = self.vector_store.search(
                query_embedding,
                user_id=user_id,
                workspace_id=workspace_id,
                top_k=top_k,
            )
            logger.info("Semantic vector search returned %d candidate(s).", len(search_results))
        except Exception as exc:
            logger.exception("Failed to search vector store.")
            search_results = []

        if not search_results:
            logger.info("No matching chunks found by vector search.")
            return []

        # filter by distance threshold
        chunk_ids: list[str] = []
        filtered_count = 0
        for chunk_id, distance in search_results:
            if distance <= distance_threshold:
                chunk_ids.append(chunk_id)
            else:
                filtered_count += 1
                logger.debug("Chunk '%s' rejected due to high distance: %.4f > %.4f", chunk_id, distance, distance_threshold)

        if filtered_count > 0:
            logger.info("Filtered threshold: %d chunks found, %d passed threshold (%.1f%%)", len(search_results), len(chunk_ids), (len(chunk_ids) / len(search_results) * 100) if search_results else 0)

        if not chunk_ids:
            logger.info("No matching chunks passed the distance threshold of %.4f.", distance_threshold)
            return []

        try:
            logger.info("Fetching %d chunk texts from Supabase for user.", len(chunk_ids))
            if workspace_id:
                db_chunks = await select_all_trusted(
                    table="documents",
                    columns="id,content,file_id,created_at,workspace_id",
                    filters={"id": chunk_ids, "workspace_id": workspace_id},
                )
            else:
                db_chunks = await select_all(
                    table="documents",
                    columns="id,content,file_id,created_at,workspace_id",
                    filters={"id": chunk_ids, "user_id": user_id},
                )

            file_ids = list(set([row["file_id"] for row in db_chunks if row.get("file_id")]))
            files_map = {}
            if file_ids:
                if workspace_id:
                    files_resp = await select_all_trusted(
                        "files",
                        "id,file_name",
                        filters={"id": file_ids, "workspace_id": workspace_id},
                    )
                else:
                    files_resp = await select_all(
                        "files",
                        "id,file_name",
                        filters={"id": file_ids, "user_id": user_id},
                    )
                files_map = {f["id"]: f.get("file_name", "Unknown File") for f in files_resp}
        except SupabaseServiceError as exc:
            logger.exception("Failed to fetch chunks from Supabase.")
            raise RuntimeError("Retrieval failed at the database stage.") from exc

        chunk_map = {row["id"]: row for row in db_chunks}
        distances_map: dict[str, float] = {cid: dist for cid, dist in search_results}

        relevant_chunks: list[dict[str, Any]] = []
        for chunk_id in chunk_ids:
            chunk_row = chunk_map.get(chunk_id)
            if chunk_row and chunk_row.get("content") and chunk_row["content"].strip():
                dist = distances_map.get(chunk_id, 0.0)
                try:
                    score = float(1.0 / (1.0 + float(dist)))
                except Exception:
                    score = 0.0

                relevant_chunks.append({
                    "content": chunk_row["content"].strip(),
                    "file_id": chunk_row.get("file_id"),
                    "file_name": files_map.get(chunk_row.get("file_id"), "Unknown File"),
                    "chunk_id": chunk_id,
                    "distance": float(dist),
                    "score": score,
                    "created_at": chunk_row.get("created_at"),
                })
            else:
                logger.warning("Chunk ID '%s' found in vector store but missing/unauthorized in database.", chunk_id)

        if not relevant_chunks:
            logger.info("Falling back to keyword search.")
            try:
                keyword = query.split()[0] if query else ""
                if keyword:
                    from ..db.supabase import get_supabase
                    supabase = get_supabase()
                    fallback_query = supabase.table("documents").select("id,content,file_id").ilike("content", f"%{keyword}%").limit(top_k)
                    if workspace_id:
                        fallback_query = fallback_query.eq("workspace_id", workspace_id)
                    else:
                        fallback_query = fallback_query.eq("user_id", user_id)
                    fallback_resp = fallback_query.execute()
                    fallback_chunks = getattr(fallback_resp, "data", None) or []

                    if fallback_chunks:
                        file_ids = list(set([row["file_id"] for row in fallback_chunks if row.get("file_id")]))
                        files_map = {}
                        if file_ids:
                            if workspace_id:
                                files_resp = await select_all_trusted(
                                    "files",
                                    "id,file_name",
                                    filters={"id": file_ids, "workspace_id": workspace_id},
                                )
                            else:
                                files_resp = await select_all(
                                    "files",
                                    "id,file_name",
                                    filters={"id": file_ids, "user_id": user_id},
                                )
                            files_map = {f["id"]: f.get("file_name", "Unknown File") for f in files_resp}

                        for chunk_row in fallback_chunks:
                            if chunk_row.get("content") and chunk_row["content"].strip():
                                relevant_chunks.append({
                                    "content": chunk_row["content"].strip(),
                                    "file_id": chunk_row.get("file_id"),
                                    "file_name": files_map.get(chunk_row.get("file_id"), "Unknown File"),
                                    "chunk_id": chunk_row.get("id"),
                                })
            except Exception as exc:
                logger.exception("Keyword fallback failed.")

        file_chunks: dict[str, list[dict[str, Any]]] = {}
        for c in relevant_chunks:
            fid = c.get("file_id") or ""
            file_chunks.setdefault(fid, []).append(c)

        for fid, clist in file_chunks.items():
            clist.sort(key=lambda x: x.get("created_at") or "")
            for idx, c in enumerate(clist):
                c["chunk_index"] = idx

        for c in relevant_chunks:
            c["preview"] = (c.get("content") or "")[:200]

        logger.info("Successfully retrieved %d chunks.", len(relevant_chunks))
        return relevant_chunks
