from __future__ import annotations
from .base import BaseAppSettings

class RetrievalSettings(BaseAppSettings):
    OMNIX_VECTOR_BACKEND: str = "pgvector"
    FAISS_INDEX_PATH: str = "./data/faiss_index.index"
    FAISS_MAP_PATH: str = "./data/faiss_map.json"
    SIMILARITY_THRESHOLD: float = 1.5
    HYBRID_TOP_K: int = 3
    HYBRID_POOL_SIZE: int = 6
    HYBRID_SEMANTIC_WEIGHT: float = 0.7
    HYBRID_KEYWORD_WEIGHT: float = 0.3
    HYBRID_DYNAMIC_WEIGHTING: bool = True
    HYBRID_CONTEXT_TOKEN_BUDGET: int = 2200
    HYBRID_MAX_CHUNK_TOKENS: int = 520
