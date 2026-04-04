from __future__ import annotations

import re
import logging
from typing import Any

from ..db.supabase_client import get_supabase
from ..services.supabase_service import execute_query_sync

logger = logging.getLogger(__name__)

class KeywordRetriever:
    """
    Implements a robust keyword-based retrieval layer for the RAG pipeline.
    This serves as the foundational retrieval layer before embeddings are introduced.
    Scores chunks based on keyword frequency, exact phrase matches, and multi-keyword overlap.
    """

    async def retrieve(
        self,
        query: str,
        user_id: str,
        conversation_id: str | None = None,
        workspace_id: str | None = None,
        top_k: int = 3,
    ) -> list[dict[str, Any]]:
        if not query or not query.strip():
            logger.warning("Empty query provided to keyword retriever.")
            return []
            
        if not user_id:
            raise ValueError("user_id is required to securely retrieve chunks.")

        try:
            supabase = get_supabase()
            
            # 1. Fetch files to restrict scope.
            files_query = supabase.table("files").select("id,file_name")
            if workspace_id:
                files_query = files_query.eq("workspace_id", workspace_id)
            else:
                files_query = files_query.eq("user_id", user_id)
                if conversation_id:
                    files_query = files_query.eq("conversation_id", conversation_id)
                
            files_resp = execute_query_sync(files_query, operation="rag keyword files")
            files_data = getattr(files_resp, "data", []) or []
            
            file_ids = [f["id"] for f in files_data]
            files_map = {f["id"]: f.get("file_name", "Unknown File") for f in files_data}
            
            if not file_ids:
                logger.info("No files found for user/conversation.")
                return []
                
            # 2. Fetch all document chunks for these files (include created_at to compute chunk index)
            docs_query = supabase.table("documents").select("id,content,file_id,created_at").in_("file_id", file_ids)
            if workspace_id:
                docs_query = docs_query.eq("workspace_id", workspace_id)
            else:
                docs_query = docs_query.eq("user_id", user_id)

            docs_resp = execute_query_sync(docs_query, operation="rag keyword documents")
            docs = getattr(docs_resp, "data", []) or []
            
            if not docs:
                logger.info("No chunks found in database.")
                return []
                
            # 3. Clean query and extract keywords
            query_clean = re.sub(r'[^\w\s]', '', query.lower())
            keywords = [w for w in query_clean.split() if len(w) > 2]
            
            if not keywords:
                # Fallback to exact string matching if no valid keywords
                keywords = [query.lower()]
                
            # 4. Score chunks
            scored_chunks = []
            for doc in docs:
                content = doc.get("content", "")
                if not content:
                    continue
                    
                content_lower = content.lower()
                score = 0.0
                
                # A. Exact phrase match
                if query_clean in content_lower:
                    score += 15.0
                    
                # B. Keyword frequency & multi-keyword overlap
                matched_keywords = 0
                for kw in keywords:
                    count = content_lower.count(kw)
                    if count > 0:
                        matched_keywords += 1
                        # Logarithmic scaling for frequency to prevent keyword stuffing dominance
                        score += (count ** 0.5) * 2.0
                
                # C. Multi-keyword overlap bonus
                if matched_keywords > 1:
                    score += (matched_keywords * 3.0)
                    
                if score > 0:
                    scored_chunks.append({
                        "content": content.strip(),
                        "file_id": doc.get("file_id"),
                        "file_name": files_map.get(doc.get("file_id"), "Unknown File"),
                        "chunk_id": doc.get("id"),
                        "created_at": doc.get("created_at"),
                        "score": score
                    })
                    
            # 5. Rank results
            scored_chunks.sort(key=lambda x: x["score"], reverse=True)
            
            # 6. Return top K
            # Compute chunk_index per file by ordering by created_at
            file_chunks: dict[str, list[dict[str, Any]]] = {}
            for c in scored_chunks:
                fid = c.get("file_id") or ""
                file_chunks.setdefault(fid, []).append(c)

            for fid, clist in file_chunks.items():
                clist.sort(key=lambda x: x.get("created_at") or "")
                for idx, c in enumerate(clist):
                    c["chunk_index"] = idx

            top_chunks = scored_chunks[:top_k]
            logger.info("Keyword retrieval found %d chunks. Returning top %d.", len(scored_chunks), len(top_chunks))
            return top_chunks
            
        except Exception as exc:
            logger.exception("Keyword retrieval failed: %s", exc)
            return []
