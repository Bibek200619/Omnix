import sys
import os
import asyncio
from fastapi.testclient import TestClient

sys.path.insert(0, os.path.abspath(os.path.dirname(__file__)))

from app.main import app
from app.core.security import get_current_user

# Mock authentication
app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user-id"}

client = TestClient(app)

def test_upload():
    # Test text file upload
    response = client.post(
        "/api/upload",
        files={"file": ("test.txt", b"Hello World", "text/plain")}
    )
    print("TXT UPLOAD RESPONSE:", response.status_code, response.json() if response.content else response.text)

    # Test pdf file upload
    response = client.post(
        "/api/upload",
        files={"file": ("test.pdf", b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "application/pdf")}
    )
    print("PDF UPLOAD RESPONSE:", response.status_code, response.json() if response.content else response.text)

test_upload()
