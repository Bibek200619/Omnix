from pydantic import BaseModel
from typing import Optional
from datetime import datetime

class MessageBase(BaseModel):
    content: str
    conversation_id: str

class MessageCreate(MessageBase):
    pass

class Message(MessageBase):
    id: str
    created_at: datetime
    user_id: str
    
    class Config:
        from_attributes = True

class ConversationBase(BaseModel):
    title: str

class ConversationCreate(ConversationBase):
    pass

class Conversation(ConversationBase):
    id: str
    user_id: str
    created_at: datetime
    updated_at: datetime
    
    class Config:
        from_attributes = True
