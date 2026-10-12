"""Access to the tracer injected by Single Step Instrumentation.

ddtrace is NOT a dependency (SSI backs off when an app bundles its own copy). When the
injected tracer is present we use it for custom tags, users and LLM Observability
annotations; in unit tests and local runs everything degrades to no-ops.
"""

from __future__ import annotations

import contextlib
from typing import Any

try:  # pragma: no cover - only present when SSI injected the tracer
    from ddtrace.trace import tracer as _tracer  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    _tracer = None

try:  # pragma: no cover
    from ddtrace.llmobs import LLMObs as _LLMObs  # type: ignore[import-not-found]
except ImportError:  # pragma: no cover
    _LLMObs = None


def tag_root(tags: dict[str, Any]) -> None:
    """Tags the request's root span, e.g. usr.id for User <-> Trace correlation."""
    if _tracer is None:
        return
    span = _tracer.current_root_span()
    if span is not None:
        for key, value in tags.items():
            if value is not None:
                span.set_tag(key, value)


@contextlib.contextmanager
def agent_workflow(name: str, session_id: str, user_id: str):
    """One customer turn as an LLM Observability workflow span, grouped by chat session.

    Child spans (LangGraph, Anthropic calls with token counts, tools) are captured by the
    auto-instrumented integrations.
    """
    if _LLMObs is None or not _LLMObs.enabled:
        yield lambda **_: None
        return
    with _LLMObs.workflow(name=name, session_id=session_id) as span:

        def annotate(**kwargs: Any) -> None:
            _LLMObs.annotate(span=span, **kwargs)

        annotate(tags={"usr.id": user_id})
        yield annotate
