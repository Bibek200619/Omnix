from abc import ABC, abstractmethod
from typing import AsyncGenerator, List, Any
from ..schemas import ChatRequest, ChatResponse, StreamChunk, EmbeddingRequest, EmbeddingResponse
from ..utils import get_logger

logger = get_logger(__name__)

class BaseLLMProvider(ABC):
    '''
    Abstract Base Class for all LLM Providers.
    Ensures a consistent interface across different AI backends.
    '''
    
    def __init__(self, name: str):
        self.name = name

    @abstractmethod
    async def generate(self, request: ChatRequest) -> ChatResponse:
        '''Generate a complete response (non-streaming).'''
        pass

    @abstractmethod
    async def stream(self, request: ChatRequest) -> AsyncGenerator[StreamChunk, None]:
        '''Generate a streaming response.'''
        pass

    @abstractmethod
    async def embeddings(self, request: EmbeddingRequest) -> EmbeddingResponse:
        '''Generate embeddings for the given input.'''
        pass

    @abstractmethod
    async def health_check(self) -> bool:
        '''Check if the provider is reachable and healthy.'''
        pass
