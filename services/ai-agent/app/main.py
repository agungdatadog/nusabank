"""ai-agent: POST /internal/agent/respond (catalog/openapi.yaml#/paths/~1internal~1agent~1respond).

Internal only — chat-service is the caller; there is no Ingress path.
"""

from __future__ import annotations

import base64
import json
import logging
import time

import anthropic
import httpx
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from langgraph.errors import GraphRecursionError
from pydantic import BaseModel, Field

from .agent import MODEL, respond
from .logs import setup_logging
from .tracing import agent_workflow, tag_root
from .tools import Session

setup_logging()
log = logging.getLogger("ai-agent")

app = FastAPI(title="Nusa Bank ai-agent", docs_url=None, redoc_url=None, openapi_url=None)
http = httpx.AsyncClient(timeout=10)

PARTNER_LLM = "anthropic"


class HistoryMessage(BaseModel):
    id: str | None = None
    role: str
    content: str
    created_at: str | None = None


class AgentRequest(BaseModel):
    session_id: str = Field(min_length=1)
    message: str = Field(min_length=1, max_length=2000)
    customer_token: str = Field(min_length=10)
    history: list[HistoryMessage] = []


def error(status: int, code: str, message: str, partner: str | None = None) -> JSONResponse:
    body = {"code": code, "message": message, **({"partner": partner} if partner else {})}
    return JSONResponse(body, status_code=status)


def cif_from_token(token: str) -> str:
    """Reads sub (= CIF) for tagging only. Authorization is enforced by each API the tools call."""
    try:
        payload = token.split(".")[1]
        return json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))["sub"]
    except (IndexError, ValueError, KeyError):
        return ""


@app.middleware("http")
async def request_log(request: Request, call_next):
    # One "request completed" line per request, inside the request span (log <-> trace).
    if request.url.path in ("/healthz", "/readyz"):
        return await call_next(request)
    start = time.perf_counter()
    response = await call_next(request)
    route = getattr(request.scope.get("route"), "path", request.url.path)
    level = logging.ERROR if response.status_code >= 500 else logging.INFO
    log.log(level, "request completed", extra={"http": {"method": request.method, "route": route, "status_code": response.status_code},
                                               "duration_ms": round((time.perf_counter() - start) * 1000)})
    return response


@app.exception_handler(RequestValidationError)
async def bad_request(_: Request, exc: RequestValidationError) -> JSONResponse:
    return error(400, "VALIDATION_ERROR", "; ".join(e["msg"] for e in exc.errors())[:300])


@app.get("/healthz")
async def healthz() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/readyz")
async def readyz() -> dict[str, str]:
    return {"status": "ok"}


@app.post("/internal/agent/respond")
async def agent_respond(req: AgentRequest):
    cif = cif_from_token(req.customer_token)
    tag_root({"usr.id": cif, "chat.session_id": req.session_id, "llm.model": MODEL})
    session = Session(token=req.customer_token)
    with agent_workflow("customer_turn", req.session_id, cif) as annotate:
        try:
            reply = await respond(http, session, [m.model_dump() for m in req.history], req.message)
        except (anthropic.APITimeoutError, anthropic.APIConnectionError):
            log.error("LLM provider timed out", extra={"partner": PARTNER_LLM, "session_id": req.session_id})
            tag_root({"partner.name": PARTNER_LLM, "error.type": "PARTNER_TIMEOUT"})
            return error(502, "PARTNER_TIMEOUT", "Asisten virtual tidak merespons, silakan coba lagi", PARTNER_LLM)
        except anthropic.APIStatusError as err:
            log.error("LLM provider error", extra={"partner": PARTNER_LLM, "status": err.status_code, "session_id": req.session_id,
                                                   "error": {"message": str(err.message)[:500]}})
            tag_root({"partner.name": PARTNER_LLM, "error.type": "PARTNER_UNAVAILABLE"})
            return error(502, "PARTNER_UNAVAILABLE", "Asisten virtual sedang gangguan, silakan coba lagi", PARTNER_LLM)
        except GraphRecursionError:
            # The model kept calling tools: hand over rather than loop or guess.
            log.warning("agent step limit reached", extra={"session_id": req.session_id})
            session.handoff = True
            reply = "Maaf, pertanyaan ini perlu dibantu petugas kami. Saya teruskan percakapan Anda sekarang."
        if not reply:
            reply = "Maaf, saya belum bisa menjawab. Silakan ulangi pertanyaan Anda."
        annotate(input_data=req.message, output_data=reply,
                 metadata={"tool_calls": [c.tool for c in session.calls], "handoff": session.handoff})
    tools = [{"tool": c.tool, "status": c.status} for c in session.calls]
    log.info("agent turn answered", extra={"session_id": req.session_id, "tools": [c.tool for c in session.calls], "handoff": session.handoff})
    return {"reply": reply, "tool_calls": tools, "handoff_to_human": session.handoff}
