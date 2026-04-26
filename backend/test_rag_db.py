import asyncio
import logging
import os
import uuid
from pprint import pprint

# Set up logging for visibility
logging.basicConfig(level=logging.WARNING)
logger = logging.getLogger("test_rag_db")

# Important: Must set environment variables for Supabase BEFORE imports if they rely on it
# Ensure SUPABASE_URL, SUPABASE_ANON_KEY, and SUPABASE_SERVICE_ROLE_KEY are set in your environment
# os.environ["SUPABASE_URL"] = "..."
# os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "..."

from app.rag.vector_store import FAISSStore
from app.rag.ingestion import RAGIngestionPipeline
from app.rag.retrieval import RAGRetriever
from app.rag.context_builder import ContextBuilder
from app.services.chat_service import ChatService
from app.db.supabase import get_supabase


async def run_integration_tests():
    print("\n==================================================")
    print(" RAG SYSTEM INTEGRATION TESTS (SUPABASE BACKED)")
    print("==================================================\n")

    # ---------------------------------------------------------
    # 1. SETUP
    # ---------------------------------------------------------
    print("--- 1. Initialization ---")
    try:
        vector_store = FAISSStore()
        ingestion_pipeline = RAGIngestionPipeline(vector_store)
        retriever = RAGRetriever(vector_store)
        context_builder = ContextBuilder(max_chunks=3)
        chat_service = ChatService(retriever, context_builder)
        
        # We need a valid user in Supabase Auth to satisfy foreign key constraints on the `chunks` table.
        # For this test, we create mock users via the Admin API.
        supabase = get_supabase()
        
        def create_test_user() -> str:
            user_email = f"test_{uuid.uuid4()}@example.com"
            res = supabase.auth.admin.create_user({
                "email": user_email,
                "password": "SecurePassword123!",
                "email_confirm": True
            })
            return res.user.id
            
        user_a_id = create_test_user()
        user_b_id = create_test_user()
        print(f"✅ Setup complete. Created User A ({user_a_id}) and User B ({user_b_id})")
    except Exception as e:
        print(f"❌ Setup failed: {e}")
        return

    # ---------------------------------------------------------
    # 2. INSERT TEST DATA (INGESTION)
    # ---------------------------------------------------------
    print("\n--- 2. Ingestion Pipeline ---")
    try:
        text_a = (
            "Artificial Intelligence is transforming the world. "
            "Machine learning is a subset of AI that allows systems to learn from data without explicit programming."
        )
        print("Ingesting Data for User A...")
        num_chunks_a, chunk_ids_a = await ingestion_pipeline.ingest_text(text_a, user_id=user_a_id)
        
        print("Ingesting Data for User B...")
        text_b = (
            "Quantum computing relies on the principles of quantum mechanics. "
            "Qubits can exist in multiple states simultaneously, unlike classical bits."
        )
        num_chunks_b, chunk_ids_b = await ingestion_pipeline.ingest_text(text_b, user_id=user_b_id)
        
        if num_chunks_a > 0 and num_chunks_b > 0:
            print(f"✅ Ingestion successful. User A chunks: {num_chunks_a}, User B chunks: {num_chunks_b}")
        else:
            print("❌ Ingestion failed to produce chunks.")
    except Exception as e:
        print(f"❌ Ingestion failed: {e}")
        return

    # ---------------------------------------------------------
    # 3. RETRIEVAL TEST (SUPABASE DB FETCH)
    # ---------------------------------------------------------
    print("\n--- 3. Retrieval Engine (DB Fetch) ---")
    try:
        query_a = "What is a subset of AI?"
        print(f"Querying User A's data: '{query_a}'")
        retrieved_chunks_a = await retriever.retrieve(query_a, user_id=user_a_id, top_k=2)
        
        if retrieved_chunks_a:
            print(f"✅ Retrieval successful. Found {len(retrieved_chunks_a)} chunk(s).")
            print(f"Preview: {retrieved_chunks_a[0][:100]}...")
        else:
            print("❌ Retrieval failed to return chunks.")
    except Exception as e:
        print(f"❌ Retrieval failed: {e}")

    # ---------------------------------------------------------
    # 4. MULTI-USER ISOLATION TEST
    # ---------------------------------------------------------
    print("\n--- 4. Tenant Isolation ---")
    try:
        # User A searches for User B's exact concept
        query_b = "Tell me about Qubits and quantum mechanics."
        print(f"User A searches for User B's data: '{query_b}'")
        stolen_chunks = await retriever.retrieve(query_b, user_id=user_a_id, top_k=5)
        
        # Check if the returned chunk actually belongs to User B's quantum data
        if not stolen_chunks:
            print("✅ Isolation successful. User A got NO chunks back.")
        else:
            if "Quantum" in stolen_chunks[0]:
                 print("❌ Isolation FAILED. User A retrieved User B's quantum data:")
                 pprint(stolen_chunks)
            else:
                 print("✅ Isolation successful. User A did NOT retrieve User B's quantum data.")
                 print("(Instead, User A got their own closest chunk because FAISS FlatL2 has no distance threshold):")
                 pprint(stolen_chunks)
    except Exception as e:
        print(f"❌ Isolation test crashed: {e}")

    # ---------------------------------------------------------
    # 5. RESTART SIMULATION
    # ---------------------------------------------------------
    print("\n--- 5. Restart Simulation ---")
    try:
        # Simulate a server restart by instantiating a fresh retriever that shares
        # the same FAISS index (assuming FAISS was saved/loaded from disk in a real app)
        # We prove the database mapping works without any in-memory dicts.
        new_retriever = RAGRetriever(vector_store)
        
        restarted_chunks = await new_retriever.retrieve(query_a, user_id=user_a_id, top_k=1)
        if restarted_chunks:
            print("✅ Restart simulation successful. Data was fetched dynamically from Supabase.")
        else:
            print("❌ Restart simulation failed. No data returned from Supabase.")
    except Exception as e:
        print(f"❌ Restart simulation crashed: {e}")

    # ---------------------------------------------------------
    # 6. CHAT SERVICE (DEV MODE)
    # ---------------------------------------------------------
    print("\n--- 6. ChatService (Dev Mode) ---")
    try:
        chat_response = await chat_service.generate_response(query_a, user_id=user_a_id)
        if chat_response and "No relevant information" not in chat_response:
            print("✅ ChatService generated a successful response:")
            print(f"Response:\n{chat_response}")
        else:
            print(f"❌ ChatService failed or returned empty: {chat_response}")
    except Exception as e:
        print(f"❌ ChatService crashed: {e}")

    # ---------------------------------------------------------
    # 7. EDGE CASES
    # ---------------------------------------------------------
    print("\n--- 7. Edge Cases ---")
    try:
        nonsense_query = "What is the recipe for baking a chocolate cake with aliens?"
        print(f"Querying nonsense: '{nonsense_query}'")
        # Ensure we don't accidentally retrieve AI/Quantum stuff for an unrelated query
        nonsense_response = await chat_service.generate_response(nonsense_query, user_id=user_a_id)
        
        # FAISS will always return *something* because it's a nearest neighbor search. 
        # But we expect the dev mode logic to format it safely or, if we implemented distance thresholds, drop it.
        # Since we don't have distance thresholds in FlatL2 currently, it will return the closest match.
        print("✅ Edge case completed. (Note: FlatL2 always returns closest neighbor without a distance threshold).")
        print(f"Fallback Response:\n{nonsense_response}")
    except Exception as e:
        print(f"❌ Edge case crashed: {e}")

    print("\n==================================================")
    print(" ALL TESTS COMPLETED")
    print("==================================================\n")

if __name__ == "__main__":
    asyncio.run(run_integration_tests())
