from fastapi import APIRouter, Depends, HTTPException
from typing import List
from ..schemas.chat import Conversation, ConversationCreate
from ..services.chat_service import chat_service

router = APIRouter(prefix="/conversations", tags=["conversations"])

@router.get("/", response_model=List[Conversation])
async def get_conversations():
    """Get all conversations"""
    pass

@router.post("/", response_model=Conversation)
async def create_conversation(conversation: ConversationCreate):
    """Create a new conversation"""
    pass

@router.get("/{conversation_id}", response_model=Conversation)
async def get_conversation(conversation_id: str):
    """Get a specific conversation"""
    pass

@router.delete("/{conversation_id}")
async def delete_conversation(conversation_id: str):
    """Delete a conversation"""
    pass
