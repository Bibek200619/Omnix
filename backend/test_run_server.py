import asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from app.routers.upload import router as upload_router
from app.core.security import get_current_user

app = FastAPI()
app.include_router(upload_router)
app.dependency_overrides[get_current_user] = lambda: {"sub": "test-user"}

client = TestClient(app)

response = client.post(
    "/upload",
    files={"file": ("test.txt", b"hello txt", "text/plain")}
)
print("Response code:", response.status_code)
print("Response body:", response.text)

