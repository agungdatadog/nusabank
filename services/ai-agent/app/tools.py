"""Read-only tools over the public Nusa Bank APIs (catalog/openapi.yaml).

Every call carries the customer's own JWT, so the agent can only see what the customer
can see, and it never touches a database. Nothing here moves money: transfers and
payments stay in the app, behind the customer's own confirmation.
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Literal

import httpx
from langchain_core.tools import BaseTool, tool

SERVICES = {
    "account": os.getenv("ACCOUNT_SERVICE_URL", "http://account-service.nusabank.svc.cluster.local:8080"),
    "payment": os.getenv("PAYMENT_SERVICE_URL", "http://payment-service.nusabank.svc.cluster.local:8080"),
    "loan": os.getenv("LOAN_SERVICE_URL", "http://loan-service.nusabank.svc.cluster.local:8080"),
    "biller": os.getenv("BILLER_SERVICE_URL", "http://biller-service.nusabank.svc.cluster.local:8080"),
    "rewards": os.getenv("REWARDS_SERVICE_URL", "http://rewards-service.nusabank.svc.cluster.local:8080"),
}


def number(n: str | int | float) -> str:
    """12450 -> '12.450' (Indonesian thousands separator)."""
    return f"{int(float(n)):,}".replace(",", ".")


def rupiah(amount: str | int | float) -> str:
    """'1500000' -> 'Rp1.500.000'."""
    return "Rp" + number(amount)


_MONTHS = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"]


def wib(iso: str) -> str:
    """API timestamps are UTC; customers think in WIB. '2026-10-12T10:23:00Z' -> '12 Okt 2026 17.23 WIB'."""
    t = datetime.fromisoformat(iso.replace("Z", "+00:00")).astimezone(timezone(timedelta(hours=7)))
    return f"{t.day} {_MONTHS[t.month - 1]} {t.year} {t:%H.%M} WIB"


def money(m: dict[str, str] | None) -> str:
    if not m:
        return "-"
    return rupiah(m["amount"]) if m.get("currency") == "IDR" else f"{m['currency']} {m['amount']}"


@dataclass
class ToolCall:
    tool: str
    status: Literal["ok", "error"]


@dataclass
class Session:
    """Per-turn state: the customer's token and what the tools did."""

    token: str
    calls: list[ToolCall] = field(default_factory=list)
    handoff: bool = False


class ToolError(Exception):
    pass


async def _get(client: httpx.AsyncClient, s: Session, service: str, path: str, **kwargs: Any) -> Any:
    return await _call(client, s, "GET", service, path, **kwargs)


async def _call(client: httpx.AsyncClient, s: Session, method: str, service: str, path: str, **kwargs: Any) -> Any:
    # httpx is traced by the injected tracer, which propagates the trace to each service.
    res = await client.request(method, SERVICES[service] + path, headers={"Authorization": f"Bearer {s.token}"}, **kwargs)
    if res.status_code >= 400:
        try:
            message = res.json().get("message", res.text)
        except ValueError:
            message = res.text
        raise ToolError(f"{service} {res.status_code}: {message}")
    return res.json()


def build_tools(client: httpx.AsyncClient, s: Session) -> list[BaseTool]:
    """Tools bound to one customer turn. Results are compact text to keep tokens low."""

    async def run(name: str, fn) -> str:
        try:
            out = await fn()
            s.calls.append(ToolCall(name, "ok"))
            return out
        except (ToolError, httpx.HTTPError) as err:
            s.calls.append(ToolCall(name, "error"))
            return f"Gagal mengambil data: {err}"

    @tool
    async def get_accounts() -> str:
        """Daftar rekening nasabah beserta saldo tersedia. Gunakan untuk pertanyaan saldo."""

        async def go() -> str:
            data = await _get(client, s, "account", "/api/accounts")
            lines = [f"- {a['product_name']} {a['account_number']} ({a['currency']}): saldo tersedia {money(a['available_balance'])}"
                     for a in data["accounts"]]
            return "\n".join(lines + [f"Total saldo setara IDR: {money(data.get('total_balance_idr'))}"])

        return await run("get_accounts", go)

    @tool
    async def get_recent_transactions(account_number: str) -> str:
        """Mutasi terakhir (10 transaksi) untuk satu nomor rekening 16 digit milik nasabah."""

        async def go() -> str:
            data = await _get(client, s, "account", f"/api/accounts/{account_number}/transactions", params={"page_size": 10})
            return "\n".join(f"- {wib(t['posted_at'])} {t['type']} {money(t['amount'])} {t['description']}" for t in data["items"]) or "Belum ada transaksi."

        return await run("get_recent_transactions", go)

    @tool
    async def get_transfer_status() -> str:
        """Status 5 transfer keluar terakhir (BI FAST, SKN, sesama Nusa Bank)."""

        async def go() -> str:
            data = await _get(client, s, "payment", "/api/transfers", params={"page_size": 5})
            return "\n".join(
                f"- {wib(t['created_at'])} {t['rail']} {money(t['amount'])} ke {t['destination_bank_name']} {t['destination_account_name']}: "
                f"{t['status']}{' (' + t['failure_reason'] + ')' if t.get('failure_reason') else ''}"
                f"{' jendela ' + t['skn_window_id'] if t.get('skn_window_id') and t['status'] == 'PROCESSING' else ''}"
                for t in data["items"]) or "Belum ada transfer."

        return await run("get_transfer_status", go)

    @tool
    async def simulate_loan(product_code: Literal["KPR", "KKB", "KTA"], asset_price: int, tenor_months: int, down_payment: int = 0) -> str:
        """Simulasi cicilan pinjaman. KPR (rumah) dan KKB (kendaraan) memakai harga aset dan uang muka;
        KTA memakai jumlah pinjaman sebagai asset_price dan down_payment 0. Nominal dalam rupiah, tenor dalam bulan."""

        async def go() -> str:
            body: dict[str, Any] = {"product_code": product_code, "asset_price": {"amount": str(asset_price), "currency": "IDR"},
                                    "tenor_months": tenor_months, "include_schedule": False}
            if product_code != "KTA" and down_payment:
                body["down_payment"] = {"amount": str(down_payment), "currency": "IDR"}
            r = await _call(client, s, "POST", "loan", "/api/loans/simulations", json=body)
            out = (f"{product_code} pokok {money(r['principal'])}, tenor {r['tenor_months']} bulan: cicilan {money(r['first_installment'])}/bulan"
                   f"{', setelah masa bunga tetap sekitar ' + money(r['floating_installment']) if r.get('floating_installment') else ''}; "
                   f"total bunga {money(r['total_interest'])}, total pembayaran {money(r['total_payment'])}.")
            return out

        return await run("simulate_loan", go)

    @tool
    async def get_bill_payments() -> str:
        """Status 5 pembayaran terakhir: top up e-wallet, pulsa, token/tagihan PLN, internet, PDAM, BPJS."""

        async def go() -> str:
            data = await _get(client, s, "biller", "/api/billers/payments", params={"page_size": 5})
            return "\n".join(
                f"- {wib(p['created_at'])} {p['biller_name']} {p.get('product_name', '')} {p['customer_number']} {money(p['amount'])}: {p['status']}"
                f"{' token ' + p['token'] if p.get('token') else ''}" for p in data) or "Belum ada pembayaran."

        return await run("get_bill_payments", go)

    @tool
    async def get_fx_rates() -> str:
        """Kurs jual dan beli USD dan JPY hari ini."""

        async def go() -> str:
            data = await _get(client, s, "account", "/api/fx/rates")
            return "\n".join(f"- {r['currency']}: beli {r['buy']}, jual {r['sell']}" for r in data["rates"])

        return await run("get_fx_rates", go)

    @tool
    async def get_rewards() -> str:
        """Saldo Nusa Poin, tier, dan poin yang dibutuhkan untuk naik tier."""

        async def go() -> str:
            r = await _get(client, s, "rewards", "/api/rewards")
            nxt = f", {number(r['points_to_next_tier'])} poin lagi ke {r['next_tier']}" if r.get("next_tier") else ""
            return f"{number(r['points'])} poin, tier {r['tier']}{nxt}"

        return await run("get_rewards", go)

    @tool
    async def handoff_to_human(reason: str) -> str:
        """Teruskan ke petugas manusia: kartu hilang/dicuri, dugaan penipuan, keluhan, atau permintaan nasabah."""
        s.handoff = True
        s.calls.append(ToolCall("handoff_to_human", "ok"))
        return f"Diteruskan ke petugas: {reason}"

    return [get_accounts, get_recent_transactions, get_transfer_status, simulate_loan, get_bill_payments, get_fx_rates, get_rewards, handoff_to_human]
