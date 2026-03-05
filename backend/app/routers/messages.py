from fastapi import APIRouter, Depends, HTTPException
from typing import List
from ..schemas.chat import Message, MessageCreate
from ..services.chat_service import chat_service

router = APIRouter(prefix="/messages", tags=["messages"])

@router.get("/conversation/{conversation_id}", response_model=List[Message])
async def get_messages(conversation_id: str):
    """Get all messages in a conversation"""
    pass

@router.post("/", response_model=Message)
async def create_message(message: MessageCreate):
    """Create a new message"""
    pass

@router.delete("/{message_id}")
async def delete_message(message_id: str):
    """Delete a message"""
    pass
