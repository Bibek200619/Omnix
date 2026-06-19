from .base import BaseLLMProvider
from typing import AsyncGenerator
from ..schemas import ChatRequest, ChatResponse, StreamChunk, EmbeddingRequest, EmbeddingResponse
from ..utils import get_logger

logger = get_logger(__name__)

class LocalModelProvider(BaseLLMProvider):
    '''
    Provider for fully self-hosted models running in the same memory space 
    or via local Transformers/vLLM engines directly initialized in Python.
    '''
    def __init__(self, model_path: str):
        super().__init__(name="local")
        self.model_path = model_path
        # self.engine = LLMEngine(model_path) # Future initialization

    async def generate(self, request: ChatRequest) -> ChatResponse:
        logger.info(f"[{self.name}] Generating via pure local model engine")
        raise NotImplementedError("Local model engine not initialized")

    async def stream(self, request: ChatRequest) -> AsyncGenerator[StreamChunk, None]:
        logger.info(f"[{self.name}] Streaming via pure local model engine")
        raise NotImplementedError("Local model stream engine not initialized")
        yield StreamChunk(id="", content="", model="") # Prevent IDE warnings

    async def embeddings(self, request: EmbeddingRequest) -> EmbeddingResponse:
        logger.info(f"[{self.name}] Generating embeddings via pure local model engine")
        raise NotImplementedError("Local model embeddings not initialized")

    async def health_check(self) -> bool:
        return bool(self.model_path)
