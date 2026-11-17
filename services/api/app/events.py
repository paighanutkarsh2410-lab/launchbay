"""In-process publish/subscribe for launch progress, consumed as Server-Sent Events."""

import asyncio
from collections import defaultdict
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any

Event = dict[str, Any]


class EventBroker:
    def __init__(self) -> None:
        self._subscribers: dict[str, set[asyncio.Queue[Event]]] = defaultdict(set)

    async def publish(self, topic: str, event: Event) -> None:
        for queue in list(self._subscribers.get(topic, ())):
            queue.put_nowait(event)

    @asynccontextmanager
    async def subscribe(self, topic: str) -> AsyncIterator[asyncio.Queue[Event]]:
        queue: asyncio.Queue[Event] = asyncio.Queue()
        self._subscribers[topic].add(queue)
        try:
            yield queue
        finally:
            self._subscribers[topic].discard(queue)
            if not self._subscribers[topic]:
                del self._subscribers[topic]
