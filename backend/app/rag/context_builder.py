from __future__ import annotations

class ContextBuilder:
    """
    Prepares the retrieved context and user query into a clean, structured 
    prompt for the LLM.
    """

    def __init__(self, max_chunks: int = 5) -> None:
        """
        Initializes the ContextBuilder.

        Args:
            max_chunks (int): The maximum number of context chunks to include in the prompt.
                              Defaults to 5.
        """
        self.max_chunks = max_chunks

    def build_context(self, query: str, chunks: list[str]) -> str:
        """
        Combines the retrieved text chunks and the user query into a formatted prompt.

        Args:
            query (str): The user's question or prompt.
            chunks (list[str]): A list of relevant text chunks retrieved from the vector store.

        Returns:
            str: A formatted prompt string containing the instructions, context, and question.
        """
        clean_query = query.strip() if query else ""

        # Clean chunks, remove duplicates, and preserve order
        seen = set()
        clean_chunks: list[str] = []
        for chunk in chunks:
            text = chunk.strip()
            if text and text not in seen:
                seen.add(text)
                clean_chunks.append(text)
                
            if len(clean_chunks) >= self.max_chunks:
                break

        # If no context is available, just return a simple prompt or handle gracefully
        if not clean_chunks:
            context_block = "No relevant context found."
        else:
            context_block = "\n\n".join(clean_chunks)

        prompt = (
            "You are an AI assistant. Answer the question based ONLY on the context below.\n\n"
            "Context:\n"
            f"{context_block}\n\n"
            "Question:\n"
            f"{clean_query}\n\n"
            "Answer:\n"
        )
        
        return prompt
