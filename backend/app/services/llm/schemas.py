from typing import List, Optional, Dict, Any, Union
from pydantic import BaseModel, Field
from enum import Enum

class Role(str, Enum):
    SYSTEM = "system"
    USER = "user"
    ASSISTANT = "assistant"
    FUNCTION = "function"

class Message(BaseModel):
    role: Role
    content: str
    name: Optional[str] = None
    function_call: Optional[Dict[str, Any]] = None

class GenerationConfig(BaseModel):
    temperature: float = 0.7
    max_tokens: int = 1000
    top_p: float = 1.0
    frequency_penalty: float = 0.0
    presence_penalty: float = 0.0
    stop: Optional[List[str]] = None

class ChatRequest(BaseModel):
    messages: List[Message]
    model: str
    config: Optional[GenerationConfig] = Field(default_factory=GenerationConfig)
    stream: bool = False

    # Future-ready hooks for RAG and Agents
    tools: Optional[List[Dict[str, Any]]] = None
    workspace_id: Optional[str] = None
    user_id: Optional[str] = None

class ChatResponse(BaseModel):
    id: str
    content: str
    model: str
    usage: Dict[str, int] = Field(default_factory=dict)
    finish_reason: Optional[str] = None

class StreamChunk(BaseModel):
    id: str
    content: str
    model: str
    finish_reason: Optional[str] = None

class EmbeddingRequest(BaseModel):
    input: Union[str, List[str]]
    model: str

class EmbeddingResponse(BaseModel):
    embeddings: List[List[float]]
    model: str
    usage: Dict[str, int] = Field(default_factory=dict)
