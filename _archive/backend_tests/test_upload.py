import sys
import os
import asyncio

# Setup path so it can import app
sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.routers.upload import _extract_text_from_bytes
from app.rag.chunking import split_text_into_chunks

# Let's try to extract plain text
try:
    res = _extract_text_from_bytes("test.txt", "text/plain", b"hello world")
    print("TEXT EXTRACTION SUCCESS:", res)
except Exception as e:
    print("TEXT EXTRACTION FAILED:", e)

