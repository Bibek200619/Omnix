import asyncio
import threading
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
import uvicorn

app = FastAPI()

@app.post("/v1/chat/completions")
async def chat(request: Request):
    data = await request.json()
    messages = data.get("messages", [])
    last = messages[-1]["content"] if messages else ""
    if "slow" in last:
        await asyncio.sleep(4.0) # > 3.0 timeout in chat_service
        return {"choices": [{"message": {"content": "This development model response was intentionally slow."}}]}
    return {"choices": [{"message": {"content": f"Omnix development model received: {last}"}}]}

if __name__ == "__main__":
    uvicorn.run(app, host="127.0.0.1", port=8001, log_level="critical")
