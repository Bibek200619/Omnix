from fastapi import APIRouter

router = APIRouter(prefix="/cache", tags=["cache"])

@router.get("/{key}")
async def get_cache(key: str):
    """Get a value from cache"""
    pass

@router.post("/{key}")
async def set_cache(key: str, value: str):
    """Set a value in cache"""
    pass

@router.delete("/{key}")
async def delete_cache(key: str):
    """Delete a value from cache"""
    pass

@router.post("/clear")
async def clear_cache():
    """Clear entire cache"""
    pass
