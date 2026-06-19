from typing import Dict, Any, List, Optional
from datetime import datetime

class RetrievalTrace:
    """Captures semantic, keyword, and hybrid retrieval diagnostics."""
    
    def __init__(self):
        self.queries: List[Dict[str, Any]] = []
        self.results: List[Dict[str, Any]] = []
        self.discarded_results: List[Dict[str, Any]] = []
        self.filters_applied: Dict[str, Any] = {}
        
    def add_query(self, query: str, query_type: str = "hybrid"):
        self.queries.append({
            "query": query,
            "type": query_type,
            "timestamp": datetime.utcnow().isoformat()
        })
        
    def set_filters(self, filters: Dict[str, Any]):
        self.filters_applied = filters
        
    def add_result(self, chunk_id: str, score: float, content_preview: str, rank: int, match_type: str = "semantic"):
        self.results.append({
            "chunk_id": chunk_id,
            "score": score,
            "preview": content_preview[:100] + "..." if len(content_preview) > 100 else content_preview,
            "rank": rank,
            "match_type": match_type
        })
        
    def add_discarded(self, chunk_id: str, reason: str, score: Optional[float] = None):
        self.discarded_results.append({
            "chunk_id": chunk_id,
            "reason": reason,
            "score": score
        })
        
    def get_snapshot(self) -> Dict[str, Any]:
        return {
            "queries": self.queries,
            "filters_applied": self.filters_applied,
            "results": self.results,
            "discarded_results": self.discarded_results,
            "total_results": len(self.results),
            "total_discarded": len(self.discarded_results)
        }
