# Use the service role key only in the backend, never in the frontend.
# The service role key bypasses Row Level Security (RLS) policies.
from supabase import create_client, Client
from ..core.config import settings

supabase: Client = create_client(
    settings.SUPABASE_URL,
    settings.SUPABASE_SERVICE_ROLE_KEY,
)

def get_supabase() -> Client:
    """Get Supabase client instance with service role permissions"""
    return supabase
