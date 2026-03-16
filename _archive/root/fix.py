import sys

def replace_in_file(filepath, old_str, new_str):
    with open(filepath, "r") as f:
        content = f.read()
    if old_str in content:
        content = content.replace(old_str, new_str)
        with open(filepath, "w") as f:
            f.write(content)
        print(f"Replaced in {filepath}")
    else:
        print(f"Could not find block in {filepath}")

# 1. ingestion.py
ingestion_old = """        try:
            logger.info("Adding %d vectors to the vector store.", num_chunks)
            user_ids = [user_id] * num_chunks
            workspace_ids = [workspace_id] * num_chunks if workspace_id else None
            # Keep the configured vector store in sync. PgVectorStore updates the
            # same persisted DB rows; FAISS/custom stores may mirror in memory.
            try:
                self.vector_store.add_embeddings(embeddings, chunk_ids, user_ids, workspace_ids)
            except Exception:
                logger.exception("Non-fatal: failed to mirror vectors into in-memory store.")
        except Exception as exc:
            logger.exception("Failed during vector store mirroring.")

        logger.info("Successfully ingested %d chunks.", num_chunks)
        return num_chunks, chunk_ids"""

ingestion_new = """        logger.info("Successfully ingested %d chunks.", num_chunks)
        return num_chunks, chunk_ids"""

replace_in_file("backend/app/rag/ingestion.py", ingestion_old, ingestion_new)

# 2. vector_store_base.py
base_old = """        Returns:
            list[tuple[str, float]]: List of (id, distance) tuples sorted by distance.
        \"\"\"
        pass

    @abstractmethod
    def save_local(self, index_path: str, map_path: str) -> None:
        \"\"\"
        Persist the vector store to disk for later recovery.
        \"\"\"
        pass

    @abstractmethod
    def load_local(self, index_path: str, map_path: str) -> None:
        \"\"\"
        Load a previously persisted vector store from disk.
        \"\"\"
        pass"""

base_new = """        Returns:
            list[tuple[str, float]]: List of (id, distance) tuples sorted by distance.
        \"\"\"
        pass"""

replace_in_file("backend/app/rag/vector_store_base.py", base_old, base_new)

# 3. pgvector_store.py
pg_old_add = """    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str], workspace_ids: list[str] | None = None) -> None:
        if not embeddings or not ids or not user_ids:
            return

        if len(embeddings) != len(ids) or len(embeddings) != len(user_ids):
            raise ValueError("The number of embeddings must match the number of IDs and user_ids.")
        if workspace_ids is not None and len(workspace_ids) != len(embeddings):
            raise ValueError("workspace_ids must match the number of embeddings when provided.")

        validate_embeddings_dimension(embeddings, expected_dim=EMBEDDING_DIMENSION, label="pgvector embeddings")

        supabase = get_supabase()

        # Iterate and update each document's embedding. Workspace filtering is optional.
        for idx, (emb, doc_id, user_id) in enumerate(zip(embeddings, ids, user_ids)):
            try:
                query = supabase.table("documents").update({"embedding": emb}).eq("id", doc_id).eq("user_id", user_id)
                # If workspace_ids provided, ensure the document belongs to the workspace
                if workspace_ids:
                    workspace_id = workspace_ids[idx]
                    if workspace_id:
                        query = query.eq("workspace_id", workspace_id)
                query.execute()
            except Exception:
                logger.exception(
                    "Failed to update document %s with local embedding (dimension=%d). "
                    "Check that documents.embedding is vector(%d) and re-run the migration if needed.",
                    doc_id,
                    len(emb),
                    EMBEDDING_DIMENSION,
                )
                raise"""

pg_new_add = """    def add_embeddings(self, embeddings: list[list[float]], ids: list[str], user_ids: list[str], workspace_ids: list[str] | None = None) -> None:
        # Embeddings are now inserted directly via the ingestion pipeline.
        # This method is retained for interface compatibility.
        pass"""

replace_in_file("backend/app/rag/pgvector_store.py", pg_old_add, pg_new_add)

pg_old_save = """            return []

    def save_local(self, index_path: str, map_path: str) -> None:
        pass

    def load_local(self, index_path: str, map_path: str) -> None:
        pass"""

pg_new_save = """            return []"""

replace_in_file("backend/app/rag/pgvector_store.py", pg_old_save, pg_new_save)

