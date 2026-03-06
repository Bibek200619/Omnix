import asyncio
import io
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.upload import router as upload_router
from app.core.security import get_current_user

app = FastAPI()
app.include_router(upload_router)
app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user"}

client = TestClient(app)

# 1. Test PDF
response = client.post(
    "/upload",
    files={"file": ("test.pdf", b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n", "application/pdf")}
)
print("PDF:", response.status_code, response.text)

# 2. Test Word document fake
response = client.post(
    "/upload",
    files={"file": ("test.docx", b"PK\x03\x04 fake docx data", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
)
print("DOCX:", response.status_code, response.text)

# 3. Test text
response = client.post(
    "/upload",
    files={"file": ("test.txt", b"hello txt", "text/plain")}
)
print("TXT:", response.status_code, response.text)

