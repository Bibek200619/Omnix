import asyncio
import uuid
import random
from datetime import datetime, timedelta, timezone

# Setup environment to load from backend
import os
import sys

from app.services.supabase_service import select_all_trusted, insert_many_trusted

async def populate():
    print("Fetching workspaces...")
    workspaces = await select_all_trusted("workspaces", "id, name, user_id")
    omni_x = next((w for w in workspaces if "omni-x" in w["name"].lower()), None)
    dev = next((w for w in workspaces if w["name"].lower() == "dev"), None)
    
    targets = [w for w in [omni_x, dev] if w]
    if not targets:
        print(f"Could not find 'omni-x' or 'Dev' workspaces in {len(workspaces)} total workspaces.")
        return

    today = datetime.now(timezone.utc)
    
    for workspace in targets:
        wid = workspace["id"]
        uid = workspace["user_id"]
        print(f"Populating workspace {workspace['name']} ({wid})...")
        
        conversations = []
        messages = []
        files = []
        
        # Over the last 7 days
        for i in range(7):
            date = today - timedelta(days=i)
            num_convos = random.randint(2, 6)
            num_files = random.randint(0, 3)
            
            for _ in range(num_convos):
                cid = str(uuid.uuid4())
                dt_str = date.isoformat()
                conversations.append({
                    "id": cid,
                    "workspace_id": wid,
                    "user_id": uid,
                    "title": f"Simulated Session {date.strftime('%b %d')}",
                    "created_at": dt_str,
                    "last_message_at": dt_str
                })
                
                # Add some messages to each conversation
                num_msgs = random.randint(3, 10)
                for _ in range(num_msgs):
                    content = "Mock message content " * random.randint(10, 30)
                    messages.append({
                        "id": str(uuid.uuid4()),
                        "workspace_id": wid,
                        "conversation_id": cid,
                        "user_id": uid,
                        "role": random.choice(["user", "assistant"]),
                        "content": content,
                        "created_at": dt_str,
                        "status": "completed"
                    })
            
            for _ in range(num_files):
                dt_str = date.isoformat()
                files.append({
                    "id": str(uuid.uuid4()),
                    "workspace_id": wid,
                    "uploader_user_id": uid,
                    "name": f"report_{date.strftime('%Y%m%d')}_{random.randint(1,100)}.pdf",
                    "status": "completed",
                    "file_size": random.randint(1024, 102400),
                    "mime_type": "application/pdf",
                    "object_path": "mock/path",
                    "created_at": dt_str,
                })
        
        if conversations:
            await insert_many_trusted("conversations", conversations)
            print(f"Inserted {len(conversations)} conversations.")
        
        # Chunk messages because inserting too many at once can fail
        chunk_size = 100
        if files:
            await insert_many_trusted("files", files)
            print(f"Inserted {len(files)} files.")

asyncio.run(populate())
