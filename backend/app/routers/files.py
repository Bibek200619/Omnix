from fastapi import APIRouter, File, UploadFile
from typing import List

router = APIRouter(prefix="/files", tags=["files"])

@router.post("/upload")
async def upload_file(file: UploadFile = File(...)):
    """Upload a file"""
    pass

@router.get("/{file_id}")
async def get_file(file_id: str):
    """Get a file"""
    pass

@router.delete("/{file_id}")
async def delete_file(file_id: str):
    """Delete a file"""
    pass
