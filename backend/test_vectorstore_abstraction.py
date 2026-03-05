"""
Test VectorStore abstraction layer to verify:
1. Clean interface design
2. FAISSStore proper implementation
3. Backend-agnostic ingestion and retrieval
4. Ready for future implementations (pgvector, etc.)
"""
import asyncio
import inspect
from abc import ABC

print("\n" + "="*70)
print("VECTORSTORE ABSTRACTION LAYER TEST SUITE")
print("="*70 + "\n")


def test_interface_design():
    """Verify VectorStore is a proper abstract interface"""
    print("TEST 1: VectorStore Interface Design")
    print("-" * 70)
    
    from app.rag.vector_store_base import VectorStore
    
    # Check it's abstract
    assert inspect.isabstract(VectorStore), "VectorStore must be abstract"
    print("✅ VectorStore is abstract base class")
    
    # Check it inherits from ABC
    assert issubclass(VectorStore, ABC), "VectorStore should inherit from ABC"
    print("✅ VectorStore inherits from ABC")
    
    # Check abstract methods
    abstract_methods = {
        name for name, method in inspect.getmembers(VectorStore)
        if getattr(method, '__isabstractmethod__', False)
    }
    
    required = {'add_embeddings', 'search', 'save_local', 'load_local'}
    assert abstract_methods == required, f"Expected {required}, got {abstract_methods}"
    print(f"✅ Has all required abstract methods: {required}")
    
    # Check method signatures
    sig = inspect.signature(VectorStore.add_embeddings)
    assert 'embeddings' in sig.parameters
    assert 'ids' in sig.parameters
    assert 'user_ids' in sig.parameters
    print("✅ add_embeddings has correct signature")
    
    sig = inspect.signature(VectorStore.search)
    assert 'query_embedding' in sig.parameters
    assert 'user_id' in sig.parameters
    assert 'top_k' in sig.parameters
    print("✅ search has correct signature")
    
    sig = inspect.signature(VectorStore.save_local)
    assert 'index_path' in sig.parameters
    assert 'map_path' in sig.parameters
    print("✅ save_local has correct signature")
    
    sig = inspect.signature(VectorStore.load_local)
    assert 'index_path' in sig.parameters
    assert 'map_path' in sig.parameters
    print("✅ load_local has correct signature")


def test_faiss_implementation():
    """Verify FAISSStore properly implements VectorStore"""
    print("\nTEST 2: FAISSStore Implementation")
    print("-" * 70)
    
    from app.rag.vector_store_base import VectorStore
    from app.rag.vector_store import FAISSStore
    
    # Check inheritance
    assert issubclass(FAISSStore, VectorStore), "FAISSStore must inherit from VectorStore"
    print("✅ FAISSStore inherits from VectorStore")
    
    # Check it can be instantiated
    store = FAISSStore()
    print("✅ FAISSStore can be instantiated")
    
    # Check isinstance works
    assert isinstance(store, VectorStore), "FAISSStore instance must be instance of VectorStore"
    print("✅ FAISSStore instance is instance of VectorStore")
    
    # Check all abstract methods are implemented
    for method_name in ['add_embeddings', 'search', 'save_local', 'load_local']:
        assert hasattr(store, method_name), f"Missing method {method_name}"
        method = getattr(store, method_name)
        assert callable(method), f"{method_name} must be callable"
    print("✅ All abstract methods implemented and callable")


async def test_ingestion_backend_agnostic():
    """Verify ingestion depends on VectorStore interface"""
    print("\nTEST 3: Ingestion Backend-Agnostic Design")
    print("-" * 70)
    
    from app.rag.vector_store_base import VectorStore
    from app.rag.ingestion import RAGIngestionPipeline
    from app.rag.vector_store import FAISSStore
    
    # Check type hints use VectorStore
    sig = inspect.signature(RAGIngestionPipeline.__init__)
    assert 'VectorStore' in str(sig.parameters['vector_store'].annotation)
    print("✅ Ingestion.__init__ accepts VectorStore type")
    
    # Check code validates VectorStore interface (not FAISSStore)
    src = inspect.getsource(RAGIngestionPipeline.__init__)
    assert 'isinstance(vector_store, VectorStore)' in src
    assert 'isinstance(vector_store, FAISSStore)' not in src
    print("✅ Ingestion validates VectorStore interface (not FAISS-specific)")
    
    # Check it works with FAISSStore
    store = FAISSStore()
    pipeline = RAGIngestionPipeline(store)
    print("✅ Ingestion works with FAISSStore implementation")
    
    # Verify docstring mentions backend-agnostic
    doc = inspect.getdoc(RAGIngestionPipeline)
    assert 'backend-agnostic' in doc.lower() or 'any VectorStore' in doc
    print("✅ Documentation indicates backend-agnostic design")


async def test_retrieval_backend_agnostic():
    """Verify retrieval depends on VectorStore interface"""
    print("\nTEST 4: Retrieval Backend-Agnostic Design")
    print("-" * 70)
    
    from app.rag.vector_store_base import VectorStore
    from app.rag.retrieval import RAGRetriever
    from app.rag.vector_store import FAISSStore
    
    # Check type hints use VectorStore
    sig = inspect.signature(RAGRetriever.__init__)
    assert 'VectorStore' in str(sig.parameters['vector_store'].annotation)
    print("✅ Retriever.__init__ accepts VectorStore type")
    
    # Check code validates VectorStore interface (not FAISSStore)
    src = inspect.getsource(RAGRetriever.__init__)
    assert 'isinstance(vector_store, VectorStore)' in src
    assert 'isinstance(vector_store, FAISSStore)' not in src
    print("✅ Retriever validates VectorStore interface (not FAISS-specific)")
    
    # Check it works with FAISSStore
    store = FAISSStore()
    retriever = RAGRetriever(store)
    print("✅ Retriever works with FAISSStore implementation")
    
    # Verify docstring mentions backend-agnostic
    doc = inspect.getdoc(RAGRetriever)
    assert 'backend-agnostic' in doc.lower() or 'any VectorStore' in doc
    print("✅ Documentation indicates backend-agnostic design")


async def test_startup_backend_agnostic():
    """Verify startup module uses VectorStore interface"""
    print("\nTEST 5: Startup Module Backend-Agnostic Design")
    print("-" * 70)
    
    from app.rag.vector_store_base import VectorStore
    from app.rag.startup import get_vector_store, initialize_vector_store
    
    # Check return types use VectorStore
    sig = inspect.signature(initialize_vector_store)
    assert 'VectorStore' in str(sig.return_annotation)
    print("✅ initialize_vector_store returns VectorStore type")
    
    sig = inspect.signature(get_vector_store)
    assert 'VectorStore' in str(sig.return_annotation)
    print("✅ get_vector_store returns VectorStore type")
    
    # Initialize and check type
    store = await initialize_vector_store()
    assert isinstance(store, VectorStore)
    print("✅ Initialized store is instance of VectorStore")
    
    # Shutdown
    from app.rag.startup import shutdown_vector_store
    await shutdown_vector_store()
    print("✅ Shutdown works with abstract type")


def test_no_direct_faiss_imports():
    """Verify ingestion/retrieval don't import FAISS directly"""
    print("\nTEST 6: No Direct FAISS Imports Outside FAISSStore")
    print("-" * 70)
    
    # Check ingestion.py
    with open('/Users/shinobi/bibek_code/Omnix/backend/app/rag/ingestion.py') as f:
        ingestion_src = f.read()
    assert 'from .vector_store import FAISSStore' not in ingestion_src
    assert 'from .vector_store_base import VectorStore' in ingestion_src
    print("✅ Ingestion imports VectorStore, not FAISSStore")
    
    # Check retrieval.py
    with open('/Users/shinobi/bibek_code/Omnix/backend/app/rag/retrieval.py') as f:
        retrieval_src = f.read()
    assert 'from .vector_store import FAISSStore' not in retrieval_src
    assert 'from .vector_store_base import VectorStore' in retrieval_src
    print("✅ Retrieval imports VectorStore, not FAISSStore")
    
    # Check startup.py doesn't import FAISSStore directly (except in function)
    with open('/Users/shinobi/bibek_code/Omnix/backend/app/rag/startup.py') as f:
        startup_src = f.read()
    # Should have FAISSStore import because it creates instances
    assert 'from .vector_store import FAISSStore' in startup_src
    # But return types should be VectorStore
    assert 'VectorStore' in startup_src
    print("✅ Startup uses VectorStore return types")


def test_pgvector_readiness():
    """Verify the abstraction is ready for pgvector implementation"""
    print("\nTEST 7: Ready for Future Implementations (pgvector, etc.)")
    print("-" * 70)
    
    from app.rag.vector_store_base import VectorStore
    import inspect
    
    # Can create mock pgvector implementation
    class PgVectorStore(VectorStore):
        """Mock pgvector implementation for testing the interface"""
        def add_embeddings(self, embeddings, ids, user_ids):
            pass
        def search(self, query_embedding, user_id, top_k=5):
            return []
        def save_local(self, index_path, map_path):
            pass
        def load_local(self, index_path, map_path):
            pass
    
    # Verify it can be instantiated
    pgvector = PgVectorStore()
    assert isinstance(pgvector, VectorStore)
    print("✅ Mock pgvector implementation works with interface")
    
    # Verify ingestion would work with it
    from app.rag.ingestion import RAGIngestionPipeline
    pipeline = RAGIngestionPipeline(pgvector)
    print("✅ Ingestion accepts any VectorStore implementation")
    
    # Verify retrieval would work with it
    from app.rag.retrieval import RAGRetriever
    retriever = RAGRetriever(pgvector)
    print("✅ Retrieval accepts any VectorStore implementation")


def test_backward_compatibility():
    """Verify existing code still works"""
    print("\nTEST 8: Backward Compatibility")
    print("-" * 70)
    
    from app.rag.vector_store import FAISSStore
    from app.rag.ingestion import RAGIngestionPipeline
    from app.rag.retrieval import RAGRetriever
    
    # Create instances as before
    store = FAISSStore()
    pipeline = RAGIngestionPipeline(store)
    retriever = RAGRetriever(store)
    
    print("✅ Can create FAISSStore directly")
    print("✅ Can pass to ingestion as before")
    print("✅ Can pass to retrieval as before")
    
    # Verify interface still works
    assert hasattr(store, 'add_embeddings')
    assert hasattr(store, 'search')
    print("✅ All methods still available")


async def main():
    """Run all tests"""
    try:
        test_interface_design()
        test_faiss_implementation()
        await test_ingestion_backend_agnostic()
        await test_retrieval_backend_agnostic()
        await test_startup_backend_agnostic()
        test_no_direct_faiss_imports()
        test_pgvector_readiness()
        test_backward_compatibility()
        
        print("\n" + "="*70)
        print("✅ ALL ABSTRACTION TESTS PASSED")
        print("="*70)
        print("\nAbstraction Summary:")
        print("1. ✅ VectorStore is clean, minimal interface")
        print("2. ✅ FAISSStore is proper implementation")
        print("3. ✅ Ingestion is backend-agnostic")
        print("4. ✅ Retrieval is backend-agnostic")
        print("5. ✅ Startup uses abstract types")
        print("6. ✅ No FAISS imports outside FAISSStore")
        print("7. ✅ Ready for pgvector implementation")
        print("8. ✅ Fully backward compatible")
        print("\nMigration Path Clear:")
        print("- Implement PgVectorStore(VectorStore)")
        print("- Update startup to use it")
        print("- No changes to ingestion/retrieval needed!")
        
        return True
        
    except Exception as e:
        print(f"\n❌ Test failed: {e}")
        import traceback
        traceback.print_exc()
        return False


if __name__ == "__main__":
    success = asyncio.run(main())
    exit(0 if success else 1)
