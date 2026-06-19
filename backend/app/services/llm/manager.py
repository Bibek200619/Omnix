from typing import Dict, Optional
from .providers.base import BaseLLMProvider
from .providers.placeholder import PlaceholderProvider
from .providers.ollama import OllamaProvider
from .providers.openai import OpenAIProvider
from .providers.local_model import LocalModelProvider
from .config import llm_settings
from .utils import get_logger

logger = get_logger(__name__)

class ProviderManager:
    '''
    Manages LLM providers, dynamically routing requests based on configuration or runtime choices.
    Handles fallbacks and provider switching.
    '''
    
    def __init__(self):
        self.providers: Dict[str, BaseLLMProvider] = {}
        self.default_provider_name: str = llm_settings.DEFAULT_PROVIDER
        self.fallback_provider_name: str = llm_settings.FALLBACK_PROVIDER
        
        self._initialize_providers()

    def _initialize_providers(self):
        '''Register all configured providers.'''
        # Always register placeholder
        self.providers["placeholder"] = PlaceholderProvider()
        
        # Register OpenAI if configured
        if llm_settings.OPENAI_API_KEY:
            self.providers["openai"] = OpenAIProvider(
                api_key=llm_settings.OPENAI_API_KEY,
                default_model=llm_settings.OPENAI_DEFAULT_MODEL
            )
            
        # Register Ollama 
        ollama_model = "phi3:mini" if llm_settings.OLLAMA_DEFAULT_MODEL == "phi3:latest" else llm_settings.OLLAMA_DEFAULT_MODEL
        self.providers["ollama"] = OllamaProvider(
            base_url=llm_settings.OLLAMA_BASE_URL,
            default_model=ollama_model,
            timeout=llm_settings.OLLAMA_TIMEOUT_SECONDS
        )
        
        # Register pure local model if path provided
        if llm_settings.LOCAL_MODEL_PATH:
            self.providers["local"] = LocalModelProvider(
                model_path=llm_settings.LOCAL_MODEL_PATH
            )
            
        logger.info(f"Initialized LLM Providers: {list(self.providers.keys())}")
        logger.info(f"Default Provider: {self.default_provider_name}")

    def get_provider(self, name: Optional[str] = None) -> BaseLLMProvider:
        '''
        Retrieves a provider by name, falling back to default or fallback providers if necessary.
        '''
        requested_name = name or self.default_provider_name
        
        provider = self.providers.get(requested_name)
        if provider:
            return provider
            
        logger.warning(f"Provider '{requested_name}' not found. Attempting fallback to '{self.fallback_provider_name}'")
        
        fallback = self.providers.get(self.fallback_provider_name)
        if fallback:
            return fallback
            
        logger.error(f"Fallback provider '{self.fallback_provider_name}' not available. Using placeholder.")
        return self.providers.get("placeholder", PlaceholderProvider())
        
# Singleton instance to be used across the application
provider_manager = ProviderManager()
