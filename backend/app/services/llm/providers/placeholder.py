import asyncio
import uuid
from typing import AsyncGenerator
from .base import BaseLLMProvider
from ..schemas import ChatRequest, ChatResponse, StreamChunk, EmbeddingRequest, EmbeddingResponse
from ..utils import get_logger

logger = get_logger(__name__)

class PlaceholderProvider(BaseLLMProvider):
    '''
    A dummy provider useful for local development, testing, and UI work 
    before real models are integrated.
    '''
    def __init__(self):
        super().__init__(name="placeholder")

    async def generate(self, request: ChatRequest) -> ChatResponse:
        logger.info(f"[{self.name}] Generating mock response for model: {request.model}")
        await asyncio.sleep(1) # Simulate network delay
        return ChatResponse(
            id=str(uuid.uuid4()),
            content="This is a placeholder response. Your actual AI model will replace this soon.",
            model=request.model,
            usage={"prompt_tokens": 10, "completion_tokens": 15, "total_tokens": 25},
            finish_reason="stop"
        )

    async def stream(self, request: ChatRequest) -> AsyncGenerator[StreamChunk, None]:
        logger.info(f"[{self.name}] Streaming mock response for model: {request.model}")
        words = "This is a streamed placeholder response. We are building the future!".split()
        res_id = str(uuid.uuid4())
        
        for i, word in enumerate(words):
            await asyncio.sleep(0.1) # Simulate token generation delay
            yield StreamChunk(
                id=res_id,
                content=word + (" " if i < len(words) - 1 else ""),
                model=request.model,
                finish_reason="stop" if i == len(words) - 1 else None
            )

    async def embeddings(self, request: EmbeddingRequest) -> EmbeddingResponse:
        logger.info(f"[{self.name}] Generating mock embeddings")
        inputs = [request.input] if isinstance(request.input, str) else request.input
        return EmbeddingResponse(
            embeddings=[[0.1] * 384 for _ in inputs],
            model=request.model,
            usage={"total_tokens": 5 * len(inputs)}
        )

    async def health_check(self) -> bool:
        return True
