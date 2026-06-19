from typing import Dict, Any, List, Optional

class PromptTrace:
    """Captures prompt assembly and injection states securely."""
    
    def __init__(self):
        self.system_prompt: Optional[str] = None
        self.injected_context: List[Dict[str, Any]] = []
        self.memory_sections: List[Dict[str, Any]] = []
        self.citations: List[Dict[str, Any]] = []
        self.tools_provided: List[Dict[str, Any]] = []
        self.final_messages: List[Dict[str, Any]] = []
        self.truncation_events: List[Dict[str, Any]] = []
        
    def set_system_prompt(self, prompt: str):
        self.system_prompt = prompt
        
    def add_context(self, source: str, content: str):
        self.injected_context.append({"source": source, "content_preview": content[:200]})
        
    def add_memory(self, memory_type: str, content: str):
        self.memory_sections.append({"type": memory_type, "content": content})
        
    def add_citation(self, citation_id: str, source_id: str):
        self.citations.append({"citation_id": citation_id, "source_id": source_id})
        
    def add_tool(self, tool_name: str, tool_description: str):
        self.tools_provided.append({"name": tool_name, "description": tool_description})
        
    def record_truncation(self, section: str, original_length: int, new_length: int, reason: str):
        self.truncation_events.append({
            "section": section,
            "original_length": original_length,
            "new_length": new_length,
            "reason": reason
        })
        
    def set_final_messages(self, messages: List[Dict[str, Any]]):
        # We store final messages, but in a real-world scenario we might sanitize them
        # to ensure no raw secrets are present.
        self.final_messages = messages
        
    def get_snapshot(self) -> Dict[str, Any]:
        return {
            "system_prompt": self.system_prompt,
            "context_injected_count": len(self.injected_context),
            "context_preview": self.injected_context,
            "memory_sections": self.memory_sections,
            "citations": self.citations,
            "tools": self.tools_provided,
            "truncation_events": self.truncation_events,
            # final_messages could be large; typically we truncate or summarize
            "final_messages_count": len(self.final_messages)
        }
