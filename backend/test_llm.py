import os
import asyncio
import httpx
import time
from concurrent.futures import ThreadPoolExecutor

os.environ["SUPABASE_URL"] = "http://localhost:8001"
os.environ["SUPABASE_ANON_KEY"] = "anon"
os.environ["SUPABASE_SERVICE_ROLE_KEY"] = "service"
os.environ["MODEL_URL"] = "http://127.0.0.1:8000/v1/chat/completions"

from app.services.chat_service import call_llm, ModelServiceError

async def test_timeout():
    print("Testing slow request (timeout)...")
    start = time.time()
    try:
        await call_llm("slow", [], 0.2)
    except ModelServiceError as e:
        print(f"Caught expected error: {e}")
    end = time.time()
    print(f"Timeout test took {end - start:.2f}s (should be ~3s)")

async def test_isolation():
    print("\nTesting isolation (1 slow, 1 fast concurrently)...")
    start = time.time()
    
    async def fast_call():
        await asyncio.sleep(0.5) # Give slow call a head start
        res = await call_llm("fast", [], 0.2)
        print(f"Fast call returned: {res}")
        return time.time()
    
    async def slow_call():
        try:
            await call_llm("slow", [], 0.2)
        except ModelServiceError:
            pass
        return time.time()
        
    results = await asyncio.gather(slow_call(), fast_call())
    slow_end, fast_end = results
    
    print(f"Fast call took: {fast_end - start - 0.5:.2f}s")
    print(f"Slow call took: {slow_end - start:.2f}s")

async def test_concurrency_limit():
    print("\nTesting concurrency limit (6 slow requests)...")
    
    async def attempt(i):
        try:
            await call_llm("slow", [], 0.2)
        except ModelServiceError as e:
            if e.status_code == 503:
                print(f"Request {i} rejected with 503 (expected capacity limit)")
            else:
                print(f"Request {i} timed out")
    
    await asyncio.gather(*[attempt(i) for i in range(6)])

async def main():
    await test_timeout()
    await test_isolation()
    await test_concurrency_limit()

if __name__ == "__main__":
    asyncio.run(main())