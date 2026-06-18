import asyncio
import os
import sys

# Setup environment to load from backend
sys.path.append(os.path.join(os.getcwd(), 'backend'))

from app.services.supabase_service import select_all_trusted

async def test():
    workspaces = await select_all_trusted("workspaces", "id, name, user_id")
    omni_x = next((w for w in workspaces if "omni-x" in w["name"].lower()), None)
    
    if not omni_x:
        print("omni-x not found")
        return
        
    wid = omni_x["id"]
    from datetime import datetime, timedelta, timezone
    today = datetime.now(timezone.utc).date()
    start_date_str = (today - timedelta(days=6)).isoformat() + "T00:00:00Z"
    
    convos = await select_all_trusted(
        "conversations", "id,created_at",
        {"workspace_id": wid, "created_at": {"gte": start_date_str}}
    )
    print(f"Found {len(convos)} convos since {start_date_str}")
    
asyncio.run(test())
