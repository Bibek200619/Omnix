import asyncio
import inspect
from typing import Callable, Dict, List, Any
import logging

from .schemas import ObservabilityEvent

logger = logging.getLogger(__name__)

EventHandler = Callable[[ObservabilityEvent], Any]

class EventBus:
    """Async event bus for observability events."""
    
    def __init__(self):
        self._subscribers: Dict[str, List[EventHandler]] = {}
        self._global_subscribers: List[EventHandler] = []
        self._queue = asyncio.Queue()
        self._worker_task = None

    def subscribe(self, event_type: str, handler: EventHandler):
        if event_type not in self._subscribers:
            self._subscribers[event_type] = []
        self._subscribers[event_type].append(handler)

    def subscribe_all(self, handler: EventHandler):
        self._global_subscribers.append(handler)

    async def publish(self, event: ObservabilityEvent):
        """Publish an event. This method is async but non-blocking."""
        try:
            # We put the event in a queue to process it asynchronously
            await self._queue.put(event)
        except Exception as e:
            logger.error(f"Failed to enqueue event: {e}")

    async def _process_events(self):
        while True:
            try:
                event = await self._queue.get()
                await self._dispatch(event)
                self._queue.task_done()
            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error(f"Error processing event: {e}")

    async def _dispatch(self, event: ObservabilityEvent):
        handlers = self._subscribers.get(event.event_type, [])
        all_handlers = handlers + self._global_subscribers
        
        for handler in all_handlers:
            try:
                if inspect.iscoroutinefunction(handler):
                    await handler(event)
                else:
                    handler(event)
            except Exception as e:
                logger.error(f"Error in event handler for {event.event_type}: {e}")

    def start(self):
        """Start the background worker to process events."""
        if self._worker_task is None:
            self._worker_task = asyncio.create_task(self._process_events())

    async def stop(self):
        """Stop the event bus and wait for remaining events to process."""
        if self._worker_task:
            self._worker_task.cancel()
            try:
                await self._worker_task
            except asyncio.CancelledError:
                pass
            self._worker_task = None

# Global Event Bus Singleton
event_bus = EventBus()
