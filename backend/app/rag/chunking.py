from __future__ import annotations

import re

# Approximation: 1 token ~= 4 characters
TARGET_CHUNK_CHARS = 800
OVERLAP_CHARS = 100


def _split_long_sentence(sentence: str, max_chars: int) -> list[str]:
    """Splits an excessively long sentence by spaces or characters to ensure safe limits."""
    words = sentence.split(" ")
    chunks = []
    current_chunk: list[str] = []
    current_length = 0

    for word in words:
        if current_length + len(word) + 1 > max_chars and current_chunk:
            chunks.append(" ".join(current_chunk))
            current_chunk = [word]
            current_length = len(word)
        else:
            current_chunk.append(word)
            current_length += len(word) + 1

    if current_chunk:
        chunks.append(" ".join(current_chunk))

    # Fallback: if a single unbroken string (like a base64 block) is larger than max_chars
    final_chunks = []
    for chunk in chunks:
        if len(chunk) > max_chars:
            for i in range(0, len(chunk), max_chars):
                final_chunks.append(chunk[i : i + max_chars])
        else:
            final_chunks.append(chunk)

    return final_chunks


def split_text_into_chunks(text: str) -> list[str]:
    """
    Splits raw text into smaller, semantic chunks for embedding generation.
    
    Targets ~500 tokens (approx 2000 characters) per chunk with an
    overlap of ~50 tokens (approx 200 characters). 
    Prioritizes splitting on sentence boundaries to maintain semantic continuity.
    
    Args:
        text (str): The raw text string to chunk.
        
    Returns:
        List[str]: A list of cleanly formatted string chunks.
    """
    if not text or not text.strip():
        return []

    # Split on sentence boundaries (., ?, !) followed by whitespace or line breaks
    sentences = re.split(r"(?<=[.?!])\s+", text.strip())
    
    # Process sentences to ensure no single sentence exceeds the hard character limit
    processed_sentences: list[str] = []
    for sentence in sentences:
        if len(sentence) > TARGET_CHUNK_CHARS:
            processed_sentences.extend(_split_long_sentence(sentence, TARGET_CHUNK_CHARS))
        elif sentence.strip():
            processed_sentences.append(sentence.strip())

    chunks: list[str] = []
    current_chunk: list[str] = []
    current_length = 0
    last_overlap_text = ""

    for sentence in processed_sentences:
        sentence_len = len(sentence)

        if current_length + sentence_len > TARGET_CHUNK_CHARS and current_chunk:
            # Finalize the current chunk
            chunk_text = " ".join(current_chunk).strip()
            if chunk_text:
                chunks.append(chunk_text)

            # Start a new chunk using the defined overlap size from previous sentences
            overlap_chunk: list[str] = []
            overlap_length = 0
            
            # Backtrack to build the overlap
            for prev_sentence in reversed(current_chunk):
                if overlap_length + len(prev_sentence) > OVERLAP_CHARS:
                    break
                overlap_chunk.insert(0, prev_sentence)
                overlap_length += len(prev_sentence) + 1  # +1 for space

            current_chunk = overlap_chunk
            current_length = overlap_length
            last_overlap_text = " ".join(overlap_chunk).strip()

        current_chunk.append(sentence)
        current_length += sentence_len + 1  # +1 for space

    # Append any remaining text as the final chunk
    if current_chunk:
        chunk_text = " ".join(current_chunk).strip()
        if chunk_text:
            if len(chunk_text) < 200 and chunks:
                # Merge the trailing small chunk into the previous chunk
                new_part = chunk_text
                if last_overlap_text and chunk_text.startswith(last_overlap_text):
                    new_part = chunk_text[len(last_overlap_text):].strip()
                
                if new_part:
                    chunks[-1] += " " + new_part
            else:
                chunks.append(chunk_text)

    return chunks
