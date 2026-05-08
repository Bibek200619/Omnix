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

# 5. main.py
main_old_startup = """@app.on_event("startup")
async def startup_event():
    \"\"\"Initialize FAISS vector store on application startup.\"\"\"
    logger.info("Starting Omnix Backend API...")
    try:
        await initialize_vector_store()
        logger.info("Vector store initialized successfully.")
    except Exception as exc:
        logger.exception("Failed to initialize vector store on startup.")
        raise"""

main_new_startup = """@app.on_event("startup")
async def startup_event():
    \"\"\"Initialize application startup.\"\"\"
    logger.info("Starting Omnix Backend API...")
    try:
        await initialize_vector_store()
        logger.info("Vector store initialized successfully.")
    except Exception as exc:
        logger.exception("Failed to initialize vector store on startup.")
        raise"""

replace_in_file("backend/app/main.py", main_old_startup, main_new_startup)

main_old_shutdown = """@app.on_event("shutdown")
async def shutdown_event():
    \"\"\"Persist FAISS vector store on application shutdown.\"\"\"
    logger.info("Shutting down Omnix Backend API...")
    try:
        await shutdown_vector_store()
        logger.info("Vector store persisted successfully.")
    except Exception as exc:
        logger.exception("Failed to persist vector store on shutdown.")"""

main_new_shutdown = """@app.on_event("shutdown")
async def shutdown_event():
    \"\"\"Application shutdown.\"\"\"
    logger.info("Shutting down Omnix Backend API...")
    try:
        await shutdown_vector_store()
        logger.info("Vector store shutdown successfully.")
    except Exception as exc:
        logger.exception("Failed to run vector store shutdown.")"""

replace_in_file("backend/app/main.py", main_old_shutdown, main_new_shutdown)

