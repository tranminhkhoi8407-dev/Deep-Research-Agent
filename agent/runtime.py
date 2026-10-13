"""Request-local runtime seam. Never swap global LLM state across users."""
from contextvars import ContextVar

research_invoker = ContextVar("research_invoker", default=None)
