import asyncio
import os
import uuid
import logging
from pprint import pprint

# Set up logging to console
logging.basicConfig(level=logging.INFO)

from app.services.supabase_service import (
    insert_one, 
    select_all, 
    select_one, 
    update_one, 
    upsert_one,
    insert_many
)

async def run_db_tests():
    user_id = str(uuid.uuid4())
    print(f"\n--- Testing Supabase Service with User ID: {user_id} ---")

    print("\n0. Testing Auth Admin - creating a user to satisfy foreign keys")
    from app.db.supabase import get_supabase
    supabase = get_supabase()
    try:
        # Create a user via the admin API
        user_email = f"test_{uuid.uuid4()}@example.com"
        user_password = "SecurePassword123!"
        response = supabase.auth.admin.create_user({
            "email": user_email,
            "password": user_password,
            "email_confirm": True
        })
        user_id = response.user.id
        print(f"Success! Created auth user: {user_id}")
    except Exception as e:
        print(f"Failed to create auth user: {e}")
        # Try fetching the first existing user ID via conversations if possible, or just fail
        try:
            res = supabase.table("conversations").select("user_id").limit(1).execute()
            if res.data:
                user_id = res.data[0]["user_id"]
                print(f"Using existing user_id from conversations: {user_id}")
            else:
                return
        except Exception as e2:
            print(f"Failed to find existing user: {e2}")
            return

    print("\n1. Testing insert_one (Conversations)")
    conv_payload = {
        "user_id": user_id,
        "title": "Test Conversation",
    }
    try:
        conversation = await insert_one("conversations", conv_payload)
        print("Success! Inserted conversation:")
        pprint(conversation)
        conv_id = conversation["id"]
    except Exception as e:
        print(f"Failed to insert conversation: {e}")
        return

    print("\n2. Testing insert_many (Messages)")
    messages_payload = [
        {
            "conversation_id": conv_id,
            "user_id": user_id,
            "role": "user",
            "content": "Hello world",
            "status": "completed"
        },
        {
            "conversation_id": conv_id,
            "user_id": user_id,
            "role": "assistant",
            "content": "Hi there!",
            "status": "completed"
        }
    ]
    try:
        messages = await insert_many("messages", messages_payload)
        print(f"Success! Inserted {len(messages)} messages:")
        pprint(messages)
    except Exception as e:
        print(f"Failed to insert messages: {e}")

    print("\n3. Testing select_all (Messages)")
    try:
        fetched_msgs = await select_all(
            "messages", 
            "id,role,content", 
            filters={"conversation_id": conv_id, "user_id": user_id}
        )
        print(f"Success! Fetched {len(fetched_msgs)} messages:")
        pprint(fetched_msgs)
    except Exception as e:
        print(f"Failed to select messages: {e}")

    print("\n4. Testing select_one (Conversation)")
    try:
        fetched_conv = await select_one(
            "conversations",
            "id,title,user_id",
            {"id": conv_id, "user_id": user_id}
        )
        print("Success! Fetched conversation:")
        pprint(fetched_conv)
    except Exception as e:
        print(f"Failed to select conversation: {e}")

    print("\n5. Testing update_one (Conversation)")
    try:
        updated_conv = await update_one(
            "conversations",
            {"id": conv_id, "user_id": user_id},
            {"title": "Updated Test Conversation"}
        )
        print("Success! Updated conversation title:")
        pprint(updated_conv)
    except Exception as e:
        print(f"Failed to update conversation: {e}")

    print("\n6. Testing upsert_one (Cache)")
    try:
        cache_entry = await upsert_one(
            "cache",
            {
                "user_id": user_id,
                "cache_key": "test_key",
                "value": "test_value"
            },
            on_conflict="user_id,cache_key"
        )
        print("Success! Upserted cache entry:")
        pprint(cache_entry)
    except Exception as e:
        print(f"Failed to upsert cache: {e}")

    print("\n--- All tests completed ---")

if __name__ == "__main__":
    asyncio.run(run_db_tests())
