from __future__ import annotations


class RetrievalChannelError(RuntimeError):
    """A channel failure that can be exposed as a safe retrieval outcome.

    The original exception remains chained for server-side logs. Callers must only
    serialize ``component`` and ``code``; raw provider messages can contain
    implementation or user data and are intentionally not part of this type's
    public contract.
    """

    def __init__(self, component: str, code: str = "unavailable") -> None:
        self.component = component
        self.code = code
        super().__init__(f"{component} retrieval is {code}")
