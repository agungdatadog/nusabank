# Nusa Bank — context for Bits Investigation

> Source of truth for **Bits Investigation → Settings → Bits.md** (Investigations and Chat).
> The UI has no API or Terraform yet, so edit here and paste the section below.

---

Nusa Bank is a fictional Indonesian internet bank (demo environment, `env:demo`).

**Services.** `nusabank-*` services in Kubernetes namespace `nusabank`. Core banking in Java
(account, ledger, loan, admin), channels in Node.js (auth, biller, rewards, chat, frontend),
payments in Go (payment). Ownership: Software Catalog teams `nusabank-payments`,
`nusabank-core`, `nusabank-channels`.

**External partners.** BI FAST and SKN (Bank Indonesia payment schemes), a PPOB biller
aggregator (GoPay, OVO, DANA, ShopeePay, LinkAja, Telkomsel, Indosat, XL, Tri, Smartfren,
PLN, PDAM, BPJS Kesehatan, IndiHome, First Media, Biznet), a credit bureau and an FX rate
feed. We have **no telemetry inside partners**; they appear as `peer.service`
(`ppob-<biller>`, `bifast`, `skn`, `credit-bureau`) on our outbound `ppob.request` /
`partner.request` spans, reached through the hosts `ppob-gateway`, `interbank-gateway`,
`credit-bureau-gateway` and `fx-gateway`. A partner 5xx or timeout with healthy internal
spans is a **partner incident**: name the partner, size the customer impact, and follow
the runbook https://github.com/agungdatadog/nusabank/blob/main/docs/runbooks/partner-outage.md

**Money safety.** Every payment reserves funds with an account-service hold before the
partner call. On partner 5xx the hold is released and the payment ends `FAILED`; on timeout
bill payments stay `PENDING`. Always state whether any customer money was moved or left held.

**Game days.** The team runs resilience drills that inject partner faults through the
`partner-mock` service (scenarios such as `bifast-errors`, `ppob-gopay-errors`). When you
find an active scenario, call the incident a **game day drill**, give the scenario and its
time window, and still report impact, blast radius and the recommended response as if the
partner outage were real.

**Known noise.** App and API Protection rule `sqr-000-014` (SSRF) fires on our own
`sslip.io` Origin/Referer headers — a known false positive, not part of an incident.
