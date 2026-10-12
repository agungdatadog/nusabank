import asyncio
import json
import logging

import httpx
from langchain_core.messages import AIMessage, HumanMessage

from app.agent import reply_text, to_messages
from app.logs import JsonFormatter
from app.main import cif_from_token
from app.tools import Session, build_tools, rupiah, wib


def test_rupiah_uses_indonesian_separators():
    assert rupiah("1500000") == "Rp1.500.000"
    assert rupiah(2500) == "Rp2.500"


def test_history_maps_roles_and_does_not_repeat_the_current_turn():
    history = [
        {"role": "assistant", "content": "Halo!"},
        {"role": "customer", "content": "saldo saya berapa"},
    ]
    msgs = to_messages(history, "saldo saya berapa")
    assert [type(m) for m in msgs] == [AIMessage, HumanMessage]
    msgs = to_messages([{"role": "agent_handoff", "content": "x"}], "halo")
    assert len(msgs) == 1 and msgs[0].content == "halo"


def test_reply_text_joins_anthropic_blocks():
    assert reply_text(AIMessage(content=[{"type": "text", "text": "Saldo "}, {"type": "text", "text": "Anda"}])) == "Saldo Anda"


def test_cif_is_read_from_the_jwt_payload():
    import base64

    payload = base64.urlsafe_b64encode(json.dumps({"sub": "1024307295"}).encode()).decode().rstrip("=")
    assert cif_from_token(f"h.{payload}.s") == "1024307295"
    assert cif_from_token("garbage") == ""


def test_tools_forward_the_customer_token_and_record_calls():
    seen = {}

    def handler(request: httpx.Request) -> httpx.Response:
        seen["auth"] = request.headers["Authorization"]
        return httpx.Response(200, json={"points": 12450, "tier": "GOLD", "next_tier": "PLATINUM", "points_to_next_tier": 27550})

    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
            s = Session(token="jwt-abc")
            tools = {t.name: t for t in build_tools(client, s)}
            out = await tools["get_rewards"].ainvoke({})
            return s, out

    s, out = asyncio.run(go())
    assert seen["auth"] == "Bearer jwt-abc"
    assert out == "12.450 poin, tier GOLD, 27.550 poin lagi ke PLATINUM"
    assert [(c.tool, c.status) for c in s.calls] == [("get_rewards", "ok")]


def test_tool_errors_are_reported_not_raised():
    async def go():
        async with httpx.AsyncClient(transport=httpx.MockTransport(lambda r: httpx.Response(503, json={"message": "down"}))) as client:
            s = Session(token="t")
            out = await {t.name: t for t in build_tools(client, s)}["get_accounts"].ainvoke({})
            return s, out

    s, out = asyncio.run(go())
    assert out.startswith("Gagal mengambil data") and s.calls[0].status == "error"


def test_json_log_nests_trace_ids():
    record = logging.LogRecord("ai-agent", logging.INFO, "", 0, "request completed", None, None)
    setattr(record, "dd.trace_id", "abc")
    record.duration_ms = 12
    line = json.loads(JsonFormatter().format(record))
    assert line["dd"] == {"trace_id": "abc"} and line["duration_ms"] == 12 and line["message"] == "request completed"


def test_timestamps_are_shown_in_wib():
    assert wib("2026-10-12T10:23:00Z") == "12 Okt 2026 17.23 WIB"
    assert wib("2026-10-31T18:05:00.123Z") == "1 Nov 2026 01.05 WIB"
