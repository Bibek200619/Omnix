from __future__ import annotations

import logging
from typing import Any

from ..core.config import get_settings
from ..services.supabase_service import SupabaseServiceError, select_all
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
        """
        Initializes the retriever.

        Args:
            vector_store (VectorStore): Any VectorStore implementation (FAISS, pgvector, etc.)
                                       containing the embeddings and ID mappings.
        """
        if not isinstance(vector_store, VectorStore):
            raise TypeError("vector_store must be an instance of VectorStore.")
        
        self.vector_store = vector_store

    async def retrieve(self, query: str, user_id: str, top_k: int = 5, distance_threshold: float | None = None) -> list[dict[str, Any]]:
        """
        Retrieves the most relevant text chunks for a given query securely from the database.

        Args:
            query (str): The search query.
            user_id (str): The ID of the user requesting the search. Used to securely 
                           filter database results to prevent cross-tenant data leaks.
            top_k (int): The maximum number of chunks to return. Defaults to 5.
            distance_threshold (float | None): The maximum L2 distance for a chunk to be considered relevant. 
                                        If None, uses SIMILARITY_THRESHOLD from config.
                                        Smaller is better. Chunks with distance > threshold are rejected.

        Returns:
            list[str]: A list of the most relevant text chunks, stripped of excess whitespace.
        """
        if not query or not query.strip():
            logger.warning("Empty query provided to retriever. Skipping search.")
            return []
        if not user_id:
            raise ValueError("user_id is required to securely retrieve chunks.")

        # Use config threshold if not explicitly provided
        if distance_threshold is None:
            distance_threshold = get_settings().SIMILARITY_THRESHOLD

        logger.info("Generating embedding for query.")
        try:
            query_embedding = get_embedding(query)
        except Exception as exc:
            logger.exception("Failed to generate query embedding.")
            query_embedding = []

        if not query_embedding:
            logger.warning("Embedding generation returned an empty vector.")
            return []

        logger.info("Searching vector store for top %d matches.", top_k)
        try:
            search_results = self.vector_store.search(query_embedding, user_id=user_id, top_k=top_k)
        except Exception as exc:
            logger.exception("Failed to search vector store.")
            search_results = []

        if not search_results:
            logger.info("No matching chunks found in the vector store.")
            return []

        chunk_ids: list[str] = []
        filtered_count = 0
        for chunk_id, distance in search_results:
            if distance <= distance_threshold:
                chunk_ids.append(chunk_id)
            else:
                filtered_count += 1
                logger.debug("Chunk '%s' rejected due to high distance: %.4f > %.4f", chunk_id, distance, distance_threshold)

        if filtered_count > 0:
            logger.info("Filtered threshold: %d chunks found, %d passed threshold (%.1f%%)", 
                       len(search_results), len(chunk_ids), 
                       (len(chunk_ids) / len(search_results) * 100) if search_results else 0)

        if not chunk_ids:
            logger.info("No matching chunks passed the distance threshold of %.4f.", distance_threshold)
            return []

        # Securely fetch all corresponding chunks from the database in a single batch query
        try:
            logger.info("Fetching %d chunk texts from Supabase for user.", len(chunk_ids))
            # include created_at to allow chunk ordering/indexing per file
            db_chunks = await select_all(
                table="documents",
                columns="id,content,file_id,created_at",
                filters={"id": chunk_ids, "user_id": user_id},
            )
            file_ids = list(set([row["file_id"] for row in db_chunks if row.get("file_id")]))
            files_map = {}
            if file_ids:
                files_resp = await select_all("files", "id,file_name", filters={"id": file_ids, "user_id": user_id})
                files_map = {f["id"]: f.get("file_name", "Unknown File") for f in files_resp}
        except SupabaseServiceError as exc:
            logger.exception("Failed to fetch chunks from Supabase.")
            raise RuntimeError("Retrieval failed at the database stage.") from exc

        # Create a fast lookup dictionary to maintain FAISS ranking order
        chunk_map = {row["id"]: row for row in db_chunks}

        # Map distances from FAISS search_results for score reporting
        distances_map: dict[str, float] = {cid: dist for cid, dist in search_results}

        relevant_chunks: list[dict[str, Any]] = []
        for chunk_id in chunk_ids:
            chunk_row = chunk_map.get(chunk_id)
            if chunk_row and chunk_row.get("content") and chunk_row["content"].strip():
                dist = distances_map.get(chunk_id, 0.0)
                # Convert distance -> similarity score (higher is better). Use simple transform.
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


        # --- KEYWORD FALLBACK ---
        if not relevant_chunks:
            logger.info("Falling back to keyword search.")
            try:
                # Basic keyword search using ilike
                keyword = query.split()[0] if query else ""
                if keyword:
                    from ..db.supabase import get_supabase
                    supabase = get_supabase()
                    fallback_resp = supabase.table("documents").select("id,content,file_id").eq("user_id", user_id).ilike("content", f"%{keyword}%").limit(top_k).execute()
                    fallback_chunks = getattr(fallback_resp, "data", None) or []
                    
                    if fallback_chunks:
                        file_ids = list(set([row["file_id"] for row in fallback_chunks if row.get("file_id")]))
                        files_map = {}
                        if file_ids:
                            files_resp = await select_all("files", "id,file_name", filters={"id": file_ids, "user_id": user_id})
                            files_map = {f["id"]: f.get("file_name", "Unknown File") for f in files_resp}
                            
                        for chunk_row in fallback_chunks:
                            if chunk_row.get("content") and chunk_row["content"].strip():
                                relevant_chunks.append({
                                    "content": chunk_row["content"].strip(),
                                    "file_id": chunk_row.get("file_id"),
                                    "file_name": files_map.get(chunk_row.get("file_id"), "Unknown File"),
                                    "chunk_id": chunk_row.get("id")
                                })
            except Exception as exc:
                logger.exception("Keyword fallback failed.")
        # ------------------------

        # Compute chunk_index per file by ordering by created_at
        file_chunks: dict[str, list[dict[str, Any]]] = {}
        for c in relevant_chunks:
            fid = c.get("file_id") or ""
            file_chunks.setdefault(fid, []).append(c)

        for fid, clist in file_chunks.items():
            clist.sort(key=lambda x: x.get("created_at") or "")
            for idx, c in enumerate(clist):
                c["chunk_index"] = idx

        # Add preview field
        for c in relevant_chunks:
            c["preview"] = (c.get("content") or "")[:200]

        logger.info("Successfully retrieved %d chunks.", len(relevant_chunks))
        return relevant_chunks

