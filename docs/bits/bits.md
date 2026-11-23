# Nusa Bank — context for Bits Investigation

> Source of truth for **Bits Investigation → Settings → Bits.md** (Investigations and Chat).
> The UI has no API or Terraform yet, so edit here and paste the section below.

---

Nusa Bank is a fictional Indonesian internet bank (demo environment, `env:demo`).

**Services.** `nusabank-*` services in Kubernetes namespace `nusabank`. Core banking in Java
(account, ledger, loan, admin), channels in Node.js (auth, biller, rewards, chat, frontend),
payments in Go (payment). Ownership: Software Catalog teams `nusabank-payments`,
`nusabank-core`, `nusabank-channels`. Application Support (`nusabank-app-support`, part of
Operations) is first line and receives monitor pages; Nusa Bank Network (`nusabank-network`)
owns connectivity to partners.

**External partners.** BI FAST and SKN (Bank Indonesia payment schemes), a PPOB biller
aggregator (GoPay, OVO, DANA, ShopeePay, LinkAja, Telkomsel, Indosat, XL, Tri, Smartfren,
PLN, PDAM, BPJS Kesehatan, IndiHome, First Media, Biznet), a credit bureau and an FX rate
feed. We have **no telemetry inside partners**; they appear as `peer.service`
(`ppob-<biller>`, `bifast`, `skn`, `credit-bureau`) on our outbound `ppob.request` /
`partner.request` spans, reached through the hosts `ppob-gateway`, `interbank-gateway`,
`credit-bureau-gateway` and `fx-gateway`. A partner 5xx or timeout with healthy internal
spans is a **partner incident**: name the partner, size the customer impact, and follow
the runbook https://github.com/agungdatadog/nusabank/blob/main/docs/runbooks/partner-outage.md

**Next steps for a partner incident**, in this order:
1. Declare a Datadog incident of type **Partner outage**: SEV-3 for one biller, SEV-2 for
   BI FAST or the whole aggregator. Team: the owner of the calling service.
2. From the incident, page the owning team with On-Call (Digital Channels for billers,
   Payments for rails, Core Banking for the credit bureau) and Nusa Bank Network to rule out
   connectivity with Cloud Network Monitoring.
3. Escalate to the partner's operations desk with the time window, error rate and a sample
   trace ID.
We do not operate partner systems or the gateways in front of them: never propose
infrastructure actions, commands or configuration changes against them. Our remediation is
the incident, the escalation and customer communication.

**Internal regressions.** Slowness or errors whose spans stay inside our services (database
spans, CPU) are ours, not a partner's. `indowebinar-pg-core` is shared by account, payment and
ledger, so one service's query load can slow the others. Start from the change that preceded
it (deployment, config or feature flag), point to the code with the file and line, and propose
the fix with Bits Code.

**Money safety.** Every payment reserves funds with an account-service hold before the
partner call. On partner 5xx the hold is released and the payment ends `FAILED`; on timeout
bill payments stay `PENDING`. Always state whether any customer money was moved or left held.

**Known noise.** App and API Protection rule `sqr-000-014` (SSRF) fires on our own
`sslip.io` Origin/Referer headers — a known false positive, not part of an incident.
