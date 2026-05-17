import httpx
import json
import uuid
from typing import AsyncGenerator
from .base import BaseLLMProvider
from ..schemas import ChatRequest, ChatResponse, StreamChunk, EmbeddingRequest, EmbeddingResponse
from ..utils import get_logger

logger = get_logger(__name__)

class OllamaProvider(BaseLLMProvider):
    '''
    Provider for local Ollama instances.
    Supports chat, streaming, and embeddings locally.
    '''
    def __init__(self, base_url: str, default_model: str, timeout: int = 60):
        super().__init__(name="ollama")
        self.base_url = base_url.rstrip('/')
        self.default_model = default_model
        self.timeout = timeout
        self.client = httpx.AsyncClient(timeout=self.timeout)

    def _format_messages(self, messages):
        return [{"role": m.role, "content": m.content} for m in messages]

    async def generate(self, request: ChatRequest) -> ChatResponse:
        logger.info(f"[{self.name}] Generating response for model: {request.model}")
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": request.model or self.default_model,
            "messages": self._format_messages(request.messages),
            "stream": False,
            "options": {
                "temperature": request.config.temperature if request.config else 0.7,
                "num_predict": request.config.max_tokens if request.config else 256,
            }
        }
        
        try:
            response = await self.client.post(url, json=payload)
            response.raise_for_status()
            data = response.json()
            
            return ChatResponse(
                id=str(uuid.uuid4()),
                content=data.get("message", {}).get("content", ""),
                model=data.get("model", self.default_model),
                usage={"eval_count": data.get("eval_count", 0), "prompt_eval_count": data.get("prompt_eval_count", 0)},
                finish_reason="stop" if data.get("done") else "unknown"
            )
        except httpx.HTTPError as e:
            logger.error(f"Ollama API error: {str(e)}")
            raise

    async def stream(self, request: ChatRequest) -> AsyncGenerator[StreamChunk, None]:
        logger.info(f"[{self.name}] Streaming response for model: {request.model}")
        url = f"{self.base_url}/api/chat"
        payload = {
            "model": request.model or self.default_model,
            "messages": self._format_messages(request.messages),
            "stream": True,
            "options": {
                "temperature": request.config.temperature if request.config else 0.7,
            }
        }
        
        res_id = str(uuid.uuid4())
        try:
            async with self.client.stream("POST", url, json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line:
                        continue
                    try:
                        chunk_data = json.loads(line)
                        yield StreamChunk(
                            id=res_id,
                            content=chunk_data.get("message", {}).get("content", ""),
                            model=chunk_data.get("model", self.default_model),
                            finish_reason="stop" if chunk_data.get("done") else None
                        )
                    except json.JSONDecodeError:
                        logger.warning(f"Failed to parse Ollama stream line: {line}")
        except httpx.HTTPError as e:
            logger.error(f"Ollama stream error: {str(e)}")
            raise

    async def embeddings(self, request: EmbeddingRequest) -> EmbeddingResponse:
        logger.info(f"[{self.name}] Generating embeddings")
        url = f"{self.base_url}/api/embeddings"
        
        inputs = [request.input] if isinstance(request.input, str) else request.input
        all_embeddings = []
        
        for text in inputs:
            payload = {
                "model": request.model or self.default_model,
                "prompt": text
            }
            try:
                response = await self.client.post(url, json=payload)
                response.raise_for_status()
                data = response.json()
                all_embeddings.append(data.get("embedding", []))
            except httpx.HTTPError as e:
                logger.error(f"Ollama API error for embeddings: {str(e)}")
                raise
                
        return EmbeddingResponse(
            embeddings=all_embeddings,
            model=request.model or self.default_model,
            usage={"total_tokens": 0} 
        )

    async def health_check(self) -> bool:
        try:
            response = await self.client.get(f"{self.base_url}/")
            return response.status_code == 200
        except Exception:
            return False
