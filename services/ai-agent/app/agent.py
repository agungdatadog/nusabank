"""The multi-step assistant: a LangGraph loop of Claude <-> read-only banking tools."""

from __future__ import annotations

import os
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from langchain_anthropic import ChatAnthropic
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage, SystemMessage
from langgraph.graph import END, START, MessagesState, StateGraph
from langgraph.prebuilt import ToolNode, tools_condition

from .tools import Session, build_tools

MODEL = os.getenv("ANTHROPIC_MODEL", "claude-haiku-5-5")
MAX_STEPS = int(os.getenv("AGENT_MAX_STEPS", "8"))

SYSTEM = """Anda adalah asisten virtual Nusa Bank, bank digital di Indonesia. Jawab dalam bahasa Indonesia
yang ramah, singkat (maksimal 4 kalimat atau daftar pendek), dan akurat.

Format: teks biasa untuk jendela chat — tanpa markdown (tanpa **, #, atau tabel); untuk daftar
gunakan baris yang diawali "- ". Tanggal dalam format Indonesia (12 Okt 2026, 14.30 WIB), nominal
seperti Rp1.500.000.

Aturan:
- Gunakan tool untuk data nasabah (saldo, mutasi, transfer, tagihan, poin, kurs, simulasi pinjaman).
  Jangan menebak angka; jika tool gagal, sampaikan dengan jujur dan sarankan mencoba lagi.
- Anda hanya bisa MELIHAT data. Anda tidak bisa melakukan transfer, pembayaran, atau perubahan apa pun;
  arahkan nasabah ke menu yang sesuai di aplikasi (Transfer, Top Up & Tagihan, Pinjaman, Poin).
- Jangan pernah meminta PIN, kata sandi, OTP, atau nomor kartu lengkap.
- Kartu hilang/dicuri, dugaan penipuan, keluhan, atau nasabah meminta petugas: panggil handoff_to_human.
- Informasi produk: BI FAST biaya Rp2.500, maks. Rp250 juta, real-time 24 jam; SKN biaya Rp2.900,
  maks. Rp1 miliar, kliring tiap 15 menit; transfer sesama Nusa Bank gratis, maks. Rp500 juta.
- Tolak dengan sopan pertanyaan di luar layanan perbankan Nusa Bank.
Waktu sekarang: {now} WIB."""


def _model() -> ChatAnthropic:
    # One retry: the customer is waiting, and chat-service already bounds the whole turn.
    # No temperature: current Claude models reject sampling parameters (HTTP 400).
    return ChatAnthropic(model=MODEL, max_tokens=1024, timeout=25, max_retries=1)


def to_messages(history: list[dict[str, Any]], message: str) -> list[BaseMessage]:
    """chat-service history (ChatMessage) -> LangChain messages; handoff notices are dropped."""
    out: list[BaseMessage] = []
    for m in history:
        if m.get("role") == "customer":
            out.append(HumanMessage(m["content"]))
        elif m.get("role") == "assistant":
            out.append(AIMessage(m["content"]))
    # chat-service includes the current turn in history; don't send it twice.
    if not out or not isinstance(out[-1], HumanMessage) or out[-1].content != message:
        out.append(HumanMessage(message))
    return out


def build_graph(client: httpx.AsyncClient, session: Session):
    tools = build_tools(client, session)
    model = _model().bind_tools(tools)
    now = (datetime.now(timezone.utc) + timedelta(hours=7)).strftime("%d %b %Y %H:%M")

    async def call_model(state: MessagesState) -> dict[str, list[BaseMessage]]:
        response = await model.ainvoke([SystemMessage(SYSTEM.format(now=now)), *state["messages"]])
        return {"messages": [response]}

    graph = StateGraph(MessagesState)
    graph.add_node("assistant", call_model)
    graph.add_node("tools", ToolNode(tools))
    graph.add_edge(START, "assistant")
    graph.add_conditional_edges("assistant", tools_condition)  # tool calls -> "tools", else END
    graph.add_edge("tools", "assistant")
    return graph.compile()


def reply_text(message: BaseMessage) -> str:
    content = message.content
    if isinstance(content, list):  # Anthropic content blocks
        content = "".join(block.get("text", "") for block in content if isinstance(block, dict))
    return str(content).strip()


async def respond(client: httpx.AsyncClient, session: Session, history: list[dict[str, Any]], message: str) -> str:
    graph = build_graph(client, session)
    # recursion_limit bounds the model<->tools loop (each round trip is two steps).
    result = await graph.ainvoke({"messages": to_messages(history, message)}, config={"recursion_limit": MAX_STEPS * 2 + 1})
    return reply_text(result["messages"][-1])


__all__ = ["respond", "to_messages", "reply_text", "END"]
