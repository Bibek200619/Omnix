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

# 4. startup.py
startup_old = """def get_vector_store() -> VectorStore:
    \"\"\"
    Returns the singleton VectorStore instance.
    Must call initialize_vector_store() during app startup first.
    
    Returns:
        VectorStore: The initialized vector store instance (any implementation).
    
    Raises:
        RuntimeError: If called before initialize_vector_store() is called.
    \"\"\"
    global _vector_store_instance
    if _vector_store_instance is None:
        raise RuntimeError("Vector store not initialized. Call initialize_vector_store() on startup.")
    return _vector_store_instance"""

startup_new = """def get_vector_store() -> VectorStore:
    \"\"\"
    Returns the singleton VectorStore instance.
    \"\"\"
    global _vector_store_instance
    if _vector_store_instance is None:
        _vector_store_instance = PgVectorStore()
    return _vector_store_instance"""

replace_in_file("backend/app/rag/startup.py", startup_old, startup_new)

startup_old_init = """async def initialize_vector_store() -> VectorStore:
    \"\"\"
    Initializes the vector store on application or worker startup.
    PgVectorStore is the default persisted vector backend.
    
    Returns:
        VectorStore: The initialized vector store instance.
    \"\"\"
    global _vector_store_instance
    
    logger.info("Initializing vector store...")
    
    # Initialize pgvector-backed store. This does not depend on FastAPI state and
    # is safe to call from workers.
    store: VectorStore = PgVectorStore()
    logger.info("Created PgVectorStore instance.")

    _vector_store_instance = store
    return store"""

startup_new_init = """async def initialize_vector_store() -> VectorStore:
    \"\"\"
    Initializes the vector store.
    \"\"\"
    return get_vector_store()"""

replace_in_file("backend/app/rag/startup.py", startup_old_init, startup_new_init)

startup_old_shutdown = """async def shutdown_vector_store() -> None:
    \"\"\"
    Gracefully shuts down the vector store on application or worker shutdown.
    \"\"\"
    global _vector_store_instance
    
    if _vector_store_instance is None:
        logger.debug("Vector store not initialized, skipping shutdown.")
        return
    
    try:
        _vector_store_instance.save_local("", "")
        logger.info("Vector store shutdown hook completed for %s.", _vector_store_instance.__class__.__name__)
    except Exception as exc:
        logger.exception("Failed to run vector store shutdown hook: %s", exc)
    
    _vector_store_instance = None"""

startup_new_shutdown = """async def shutdown_vector_store() -> None:
    \"\"\"
    Gracefully shuts down the vector store on application or worker shutdown.
    \"\"\"
    global _vector_store_instance
    _vector_store_instance = None"""

replace_in_file("backend/app/rag/startup.py", startup_old_shutdown, startup_new_shutdown)

