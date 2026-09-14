import pytest
import asyncio
from types import SimpleNamespace
from typing import AsyncGenerator
from app.observability import safe_logging
from app.observability.tracing import ContextTrace
from app.observability.streaming import StreamingRuntime
from app.observability.runtime import ExecutionRuntime
from app.observability.event_bus import EventBus
from app.observability.schemas import ObservabilityEvent
from app.observability.serializers import sanitize_dict


@pytest.fixture(autouse=True)
def allow_sensitive_observability_traces(monkeypatch):
    monkeypatch.setattr(safe_logging, "get_settings", lambda: SimpleNamespace(ENV="test", DEV_MODE=True))


@pytest.mark.asyncio
async def test_retrieval_tracing():
    trace = ContextTrace(workspace_id="test_ws")
    trace.retrieval.add_query("test query")
    trace.retrieval.add_result("chunk_1", 0.9, "content preview", 1)
    trace.retrieval.add_discarded("chunk_2", "low score")
    
    snapshot = trace.retrieval.get_snapshot()
    assert len(snapshot["queries"]) == 1
    assert snapshot["total_results"] == 1
    assert snapshot["total_discarded"] == 1

@pytest.mark.asyncio
async def test_prompt_tracing():
    trace = ContextTrace()
    trace.prompt.set_system_prompt("You are a helpful assistant.")
    trace.prompt.add_context("doc1", "Here is some context.")
    trace.prompt.record_truncation("memory", 1000, 500, "token_limit")
    
    snapshot = trace.prompt.get_snapshot()
    assert snapshot["system_prompt"] == "You are a helpful assistant."
    assert snapshot["context_injected_count"] == 1
    assert len(snapshot["truncation_events"]) == 1

@pytest.mark.asyncio
async def test_token_budgeting_visibility():
    trace = ContextTrace()
    trace.tokens.track_prompt_tokens(500)
    trace.tokens.track_completion_tokens(100)
    trace.tokens.track_retrieval_tokens(300)
    trace.tokens.reserve_completion_tokens(200)
    
    snapshot = trace.metrics.get_snapshot()
    assert snapshot["tokens"]["prompt_tokens"] == 500
    assert snapshot["tokens"]["completion_tokens"] == 100
    assert snapshot["tokens"]["total_tokens"] == 600
    assert snapshot["tokens"]["retrieval_tokens"] == 300
    assert snapshot["tokens"]["reserved_completion_tokens"] == 200

@pytest.mark.asyncio
async def test_provider_failure_handling():
    trace = ContextTrace()
    trace.provider.set_provider("openai", "gpt-4")
    trace.provider.record_error("Rate limit exceeded")
    trace.provider.record_fallback("ollama", "phi3:mini")
    
    snapshot = trace.provider.get_snapshot()
    assert snapshot["error"] == "Rate limit exceeded"
    assert snapshot["fallback_triggered"] is True
    assert snapshot["provider"] == "ollama"

@pytest.mark.asyncio
async def test_streaming_interruption_recovery():
    trace = ContextTrace()
    runtime = StreamingRuntime(trace)
    
    async def mock_provider_stream() -> AsyncGenerator[str, None]:
        for i in range(5):
            await asyncio.sleep(0.01)
            yield f"token_{i}"
            
    # Simulate an interruption during stream
    chunks = []
    async for chunk in runtime.stream_generator(mock_provider_stream()):
        chunks.append(chunk)
        if len(chunks) == 2:
            runtime.interrupt()
            
    assert len(chunks) == 2
    snapshot = trace.provider.get_snapshot()
    assert snapshot["error"] == "Stream interrupted by runtime"
    
@pytest.mark.asyncio
async def test_async_execution_safety():
    # Verify that multiple traces don't interfere with each other
    async def run_trace(req_id: str):
        async with ExecutionRuntime(workspace_id="ws1", request_id=req_id) as runtime:
            runtime.trace.start_timer("retrieval")
            await asyncio.sleep(0.1)
            runtime.trace.stop_timer("retrieval")
            return runtime.trace.metrics.get_snapshot()["latencies"]["retrieval_ms"]
            
    results = await asyncio.gather(run_trace("1"), run_trace("2"))
    assert len(results) == 2
    for r in results:
        assert r > 0

def test_workspace_isolation():
    trace1 = ContextTrace(workspace_id="ws_A")
    trace2 = ContextTrace(workspace_id="ws_B")
    
    trace1.retrieval.add_query("query A")
    trace2.retrieval.add_query("query B")
    
    assert trace1.context.workspace_id == "ws_A"
    assert trace2.context.workspace_id == "ws_B"
    assert trace1.retrieval.get_snapshot()["queries"][0]["query"] == "query A"
    assert trace2.retrieval.get_snapshot()["queries"][0]["query"] == "query B"

def test_malformed_prompts_sanitization():
    # Test our sanitizer
    malformed = {
        "user_message": "Hello, my Bearer token is Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9",
        "api_key": "sk-1234567890",
        "nested": {
            "supabase_key": "some-secret-key"
        }
    }
    
    sanitized = sanitize_dict(malformed)
    assert "eyJhbGciOi" not in sanitized["user_message"]
    assert "***REDACTED***" in sanitized["user_message"]
    assert sanitized["api_key"] == "***REDACTED***"
    assert sanitized["nested"]["supabase_key"] == "***REDACTED***"

@pytest.mark.asyncio
async def test_event_bus_reliability():
    bus = EventBus()
    received_events = []
    
    def handler(event: ObservabilityEvent):
        received_events.append(event)
        
    bus.subscribe("test_event", handler)
    bus.start()
    
    trace = ContextTrace()
    event = ObservabilityEvent(
        event_type="test_event",
        trace_context=trace.context,
        payload={"msg": "hello"}
    )
    
    await bus.publish(event)
    
    # Wait for the queue to process
    await asyncio.sleep(0.1)
    await bus.stop()
    
    assert len(received_events) == 1
    assert received_events[0].payload["msg"] == "hello"
