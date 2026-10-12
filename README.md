# Nusa Bank — Datadog Financial Services Demo

A fictional Indonesian internet banking application, built as the single running
application behind a four-episode Datadog webinar series for financial services.

> **Fictional institution.** "Nusa Bank" does not exist. All customers, accounts,
> balances and transactions are synthetic. No real bank's branding, product names
> or copy is used. `BI FAST` and `SKN` are referenced as the public national payment
> schemes operated by Bank Indonesia, in the same way `SWIFT` or `ACH` would be.
> Destination banks, e-wallets and billers appear by name only (no logos) as
> transfer and payment destinations, the way every Indonesian banking app lists them.

---

## The webinar series

One application, four episodes, each layering more of the Datadog platform on top
of the *same* running system.

| Episode | Title | Question | Pillar focus |
|---------|-------|----------|--------------|
| **EP1 — SEE** | Beyond Visibility: See the Complete Picture of Digital Financial Services | What is happening? | Business metrics · RUM / DEM · APM · Logs · DBM · Infrastructure & Network |
| **EP2 — UNDERSTAND** | When Every Transaction Matters: From Customer Impact to Root Cause | Why did it happen? | Session Replay · Error Tracking · Continuous Profiler · transaction-level correlation |
| **EP3 — ACT** | Operating Resilient Financial Services: From Detection to Recovery | How do we respond and recover? | SLO · On-Call · Incident Management · Workflow Automation · Software Catalog |
| **EP4 — EVOLVE** | The Next Frontier: AI-Powered Financial Services | How do we operate the next generation? | LLM Observability · AI Agent Console · AI quality/latency/cost · AI Guard |

**EP1 air date: 29 October 2026.**

The application is built **complete before EP1**. What phases per episode is the
*Datadog configuration* and the *demo scenarios* — not the app itself. This avoids
rebuilding dashboards, SLOs and catalog entries four times.

---

## Services

13 services, 5 languages. The polyglot spread is deliberate: it demonstrates one
observability platform across the language mix a real bank actually runs — **core
banking on Java, channels and integrations on Node.js, the high-throughput payment
path on Go, AI on Python.**

| Language | Services |
|----------|----------|
| Java 21 | account, ledger, loan, admin |
| Node.js / TypeScript | auth, biller, rewards, chat (+ frontend) |
| Go | payment, partner-mock |
| Python | ai-agent |
| k6 (JavaScript) | load-generator |

| Service | Language / Framework | Role | Datadog showcase |
|---------|---------------------|------|------------------|
| [frontend](services/frontend/) | TypeScript / React 18 + Vite / Nginx + nginx-datadog | Web banking UI | RUM, Session Replay, Error Tracking, Synthetics |
| [auth-service](services/auth-service/) | Node.js 22 / TypeScript / Hono | Login, JWT, MFA, onboarding funnel | APM, Profiler, Code Security (IAST), AAP |
| [account-service](services/account-service/) | Java 21 / Spring Boot 4.1 | Products, balances, transactions, e-Statement | APM, DBM, Profiler (JVM), Code Security |
| [payment-service](services/payment-service/) | Go 1.27 / chi | Transfer rails: intrabank, BI FAST (instant), SKN (batch clearing) | APM, Data Streams Monitoring, business metrics per rail & destination bank |
| [ledger-worker](services/ledger-worker/) | Java 21 / Kafka consumer | Double-entry ledger posting — source of truth for journals | APM, DSM, Profiler |
| [loan-service](services/loan-service/) | Java 21 / Spring Boot 4.1 | KPR, KKB, KTA — simulation, application, credit check | APM, Profiler (amortisation is CPU-heavy), application funnel |
| [biller-service](services/biller-service/) | Node.js 22 / TypeScript / Hono | E-wallet top-up, pulsa & data, internet/TV, PLN, PDAM, BPJS — inquiry → pay | APM, partner SLO per biller |
| [rewards-service](services/rewards-service/) | Node.js 22 / TypeScript / Hono + kafkajs | Loyalty points, event-driven | APM, DSM, eventual consistency |
| [chat-service](services/chat-service/) | Node.js 22 / TypeScript / Hono | Customer support chat sessions | APM, DBM (MongoDB), AAP |
| [ai-agent](services/ai-agent/) | Python 3.12 / FastAPI + LangGraph | Multi-step LLM agent (internal only) | LLM Observability, AI Agent Console, AI Guard |
| [admin-service](services/admin-service/) | Java 21 / Spring Boot 4.1 + Spring Security | Back-office operator console, role-based | APM, Profiler (JVM), SCA |
| [partner-mock](services/partner-mock/) | Go 1.27 / chi | Simulates BI FAST, SKN clearing, PPOB biller aggregator, credit bureau, FX rates — **with live-togglable latency and error injection** | The failure-injection toolkit for EP2–EP3 |
| [load-generator](services/load-generator/) | k6 | Realistic business traffic + controlled spikes | Traffic history for SLOs and baselines |

### Feature map

Modelled on the information architecture common to Indonesian internet banking.

| Feature | Service | Notes |
|---------|---------|-------|
| My Accounts — product list | account-service | Savings & Current, Credit Card, Time Deposit, Loan/Financing, Investment as *product types* |
| Multi-currency (IDR / USD / JPY) | account-service → partner-mock | FX rate lookup is an external dependency |
| Transfer (intrabank) | payment-service | Synchronous, posts to ledger via Kafka |
| **BI FAST** (interbank instant) | payment-service → partner-mock | Real-time, max Rp250 juta. External rail: timeouts, retries, partial failure |
| **SKN** (interbank batch clearing) | payment-service → partner-mock | Max Rp1 miliar. Status `PROCESSING` until the next clearing window; cut-off rolls to the next window. Windows are configurable (default every 15 min) so a full cycle fits in a live demo |
| Loans — KPR, KKB, KTA | loan-service → partner-mock | Simulation (annuity / flat, fixed-then-floating), application, document upload, credit check |
| Top Up — GoPay, OVO, ShopeePay, DANA, LinkAja | biller-service → partner-mock | Inquiry → confirm → pay, via a PPOB aggregator |
| Pulsa & data — Telkomsel, Indosat, XL, Tri, Smartfren | biller-service → partner-mock | Denomination catalogue per operator |
| Bills — internet/TV, PLN, PDAM, BPJS Kesehatan | biller-service → partner-mock | Two partner calls per payment, either can fail |
| My Transactions / e-Statement | account-service | Heavy queries, PDF generation |
| Rewards points | rewards-service | Kafka consumer off transaction events |
| Apply & Promotions (onboarding) | auth-service + frontend | Conversion funnel — the EP1 business metric |
| Settings / profile / MFA | auth-service | |

### Business metrics

Emitted via DogStatsD. Amounts are metric *values* (distributions in IDR), never
tags, to keep custom-metric cardinality bounded.

| Metric | Type | Tags |
|--------|------|------|
| `nusabank.transfer.count` | count | `rail` (intrabank / bifast / skn), `destination_bank`, `status` |
| `nusabank.transfer.amount` | distribution (IDR) | `rail`, `destination_bank`, `status` |
| `nusabank.biller.payment.count` / `.amount` | count / distribution | `category`, `biller`, `status` |
| `nusabank.loan.simulation.count` | count | `product` |
| `nusabank.loan.application.count` / `.amount` | count / distribution | `product`, `stage` (submitted / approved / rejected / disbursed) |
| `nusabank.onboarding.step.count` | count | `product`, `step` |
| `nusabank.rewards.points.earned` | count (points) | `source` (transfer / bill), `segment` |
| `nusabank.rewards.redemption.count` / `.points.redeemed` | count | `item` |
| `nusabank.chat.session.count` / `.message.count` / `.handoff.count` | count | `responder` (faq / agent), `intent`, `handoff` |

---

## Data layer

**Database per service.** Each service owns its database and its own DB user, and
touches no other service's database. Data owned elsewhere is read through that
service's API or a Kafka event — never a cross-database query.

| Instance | Engine | Databases (owner) | Why grouped |
|----------|--------|-------------------|-------------|
| `indowebinar-pg-core` | Cloud SQL PostgreSQL 15 | `account`, `payment`, `ledger` | Core transaction path |
| `indowebinar-pg-channel` | Cloud SQL PostgreSQL 15 | `auth`, `loan`, `admin` | Channels and back-office, isolated from core |
| `indowebinar-mysql-partner` | Cloud SQL MySQL 8.4 | `biller`, `rewards` | Partner integrations and loyalty |

| Other store | Deployment | Used by |
|-------------|-----------|---------|
| MongoDB | In-cluster StatefulSet + PVC | chat-service |
| Redis | In-cluster StatefulSet + PVC | account-service (cache), ai-agent (conversation memory) |
| Kafka | Strimzi (in-cluster) | see topics below |

| Topic | Producer | Consumers |
|-------|----------|-----------|
| `payments.transfer.v1` | payment-service | ledger-worker, rewards-service |
| `biller.payment.v1` | biller-service | ledger-worker, rewards-service |
| `loan.disbursement.v1` | loan-service | ledger-worker |
| `ledger.posted.v1` | ledger-worker | account-service (balance projection) |

`ledger-worker` is the source of truth for journals; `account-service` keeps balances
as a projection of `ledger.posted.v1`. Funds are reserved synchronously (a *hold* on
account-service) before a rail is called, so balances never go negative while the
ledger catches up.

Why this layout earns its place on screen:

- **Noisy neighbour (EP2)** — the e-Statement N+1 scenario loads `pg-core`, and BI
  FAST transfers slow down with it. DBM shows the root cause sits in another service.
- **Blast radius (EP1/EP3)** — at the same moment, login and loan simulation on
  `pg-channel` stay healthy. The service map shows what is and isn't affected.
- **Stale balance (EP2)** — Kafka consumer lag delays the balance projection; DSM
  shows which consumer is behind.
- **Multi-engine DBM (EP1)** — PostgreSQL, MySQL and MongoDB in one view.

Cloud SQL rather than in-cluster databases: managed engines give the better DBM
story, and data survives pod rescheduling.

---

## Architecture

```
[Browser]
    │  HTTPS  (RUM + Session Replay)
    ▼
[frontend]  ──── JWT ───▶ [auth-service] ──────▶ pg-channel/auth
    │
    ├──────────────────▶ [account-service] ───▶ pg-core/account · Redis
    │                       ▲      │
    │              holds    │      └─────────▶ [partner-mock]  (FX rates)
    │                       │
    ├──────────────────▶ [payment-service] ───▶ pg-core/payment
    │                             ├──────────▶ [partner-mock]  (BI FAST, SKN clearing)
    │                             └── Kafka ─▶ payments.transfer.v1
    │
    ├──────────────────▶ [biller-service] ────▶ mysql-partner/biller
    │                             ├──────────▶ [partner-mock]  (PPOB aggregator)
    │                             └── Kafka ─▶ biller.payment.v1
    │
    ├──────────────────▶ [loan-service] ──────▶ pg-channel/loan
    │                             ├──────────▶ [partner-mock]  (credit bureau)
    │                             └── Kafka ─▶ loan.disbursement.v1
    │
    ├──────────────────▶ [rewards-service] ───▶ mysql-partner/rewards
    ├──────────────────▶ [admin-service] ─────▶ pg-channel/admin
    └──────────────────▶ [chat-service] ──────▶ MongoDB
                                  │  internal only, no Ingress
                                  ▼
                            [ai-agent] ───────▶ Claude API · Redis

Kafka: payments.transfer.v1 / biller.payment.v1 / loan.disbursement.v1
         ──▶ [ledger-worker] ──▶ pg-core/ledger ──▶ ledger.posted.v1 ──▶ [account-service]
       payments.transfer.v1 / biller.payment.v1 ──▶ [rewards-service]
```

---

## Infrastructure

- **GCP project:** `datadog-ese-sandbox` — shared with other teams, so every GCP
  object is named `indowebinar-*` and labelled `app=nusabank`, `group=indowebinar`
- **Region:** `asia-southeast2` (Jakarta)
- **GKE Standard** — not Autopilot; Cloud Network Monitoring and Universal Service
  Monitoring need agent privileges Autopilot restricts
- **Artifact Registry** for all service images
- **tfstate:** `gs://ctf-tfstate-agung/indowebinar-*`
- **Datadog:** org on **US1**, `DD_ENV=demo`, namespace `nusabank`

---

## Repository layout

```
/
├── AGENTS.md              # Project instructions for coding agents (CLAUDE.md is a symlink)
├── catalog/
│   └── openapi.yaml       # Single source of truth for all inter-service APIs (API-first)
├── k8s/
│   ├── services/          # Per-service manifests
│   ├── platform/          # Postgres proxy, MongoDB, Redis, Kafka (Strimzi)
│   └── agent/             # DatadogAgent CR
├── terraform/
│   ├── infra/             # GKE, node pool, Artifact Registry, 3× Cloud SQL
│   ├── k8s/               # Datadog Operator, namespace, secrets
│   └── datadog/           # Dashboards, monitors, SLOs, Synthetics — observability as code
├── services/              # All 13 services
├── local/                 # docker-compose for local development
├── tools/                 # Demo scenario toggles, traffic helpers
└── docs/
    ├── architecture.md
    ├── episodes/          # Per-episode demo scripts and runbooks
    └── operations/        # Deploy, secrets, troubleshooting
```

---

## Status

🚧 **Under active construction.** See [docs/operations/deploy.md](docs/operations/deploy.md)
for current setup steps and [docs/episodes/](docs/episodes/) for episode readiness.
