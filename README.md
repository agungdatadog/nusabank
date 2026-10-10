# Nusa Bank — Datadog Financial Services Demo

A fictional Indonesian internet banking application, built as the single running
application behind a four-episode Datadog webinar series for financial services.

> **Fictional institution.** "Nusa Bank" does not exist. All customers, accounts,
> balances and transactions are synthetic. No real bank's branding, product names
> or copy is used. `BI FAST` is referenced as the public national payment scheme
> operated by Bank Indonesia, in the same way `SWIFT` or `ACH` would be.

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

12 services, 5 languages. The polyglot spread is deliberate: it demonstrates one
observability platform across the language mix a real bank actually runs.

| Service | Language / Framework | Role | Datadog showcase |
|---------|---------------------|------|------------------|
| [frontend](services/frontend/) | TypeScript / React 18 + Vite / Nginx + nginx-datadog | Web banking UI | RUM, Session Replay, Error Tracking, Synthetics |
| [auth-service](services/auth-service/) | Python 3.12 / FastAPI | Login, JWT, MFA, onboarding funnel | APM, Profiler, Code Security (IAST), AAP |
| [account-service](services/account-service/) | Java 21 / Spring Boot 3.3 | Products, balances, transactions, e-Statement | APM, DBM, Profiler (JVM), Code Security |
| [payment-service](services/payment-service/) | Go 1.23 / chi | Transfer (intrabank) + BI FAST (interbank) | APM, Data Streams Monitoring |
| [ledger-worker](services/ledger-worker/) | Java 21 / Kafka consumer | Double-entry ledger posting | APM, DSM, Profiler |
| [biller-service](services/biller-service/) | Node.js 22 / Hono | Bills & top-up via partners | APM, partner SLO |
| [rewards-service](services/rewards-service/) | Python 3.12 / FastAPI | Loyalty points, event-driven | APM, DSM, eventual consistency |
| [chat-service](services/chat-service/) | Node.js 22 / Hono | Customer support chat sessions | APM, DBM (MongoDB), AAP |
| [ai-agent](services/ai-agent/) | Python 3.12 / FastAPI + LangGraph | Multi-step LLM agent (internal only) | LLM Observability, AI Agent Console, AI Guard |
| [admin-service](services/admin-service/) | Go 1.23 / chi | Back-office operator console | APM, Profiler, SCA |
| [partner-mock](services/partner-mock/) | Go 1.23 | Simulates BI FAST rail, billers, FX rates — **with live-togglable latency and error injection** | The failure-injection toolkit for EP2–EP3 |
| [load-generator](services/load-generator/) | k6 | Realistic business traffic + controlled spikes | Traffic history for SLOs and baselines |

### Feature map

Modelled on the information architecture common to Indonesian internet banking.

| Feature | Service | Notes |
|---------|---------|-------|
| My Accounts — product list | account-service | Savings & Current, Credit Card, Time Deposit, Loan/Financing, Investment as *product types* |
| Multi-currency (IDR / USD / JPY) | account-service → partner-mock | FX rate lookup is an external dependency |
| Transfer (intrabank) | payment-service | Synchronous, posts to ledger via Kafka |
| **BI FAST** (interbank instant) | payment-service → partner-mock | External rail: timeouts, retries, partial failure |
| Bills & Top Up | biller-service → partner-mock | Third-party biller failures |
| My Transactions / e-Statement | account-service | Heavy queries, PDF generation |
| Rewards points | rewards-service | Kafka consumer off transaction events |
| Apply & Promotions (onboarding) | auth-service + frontend | Conversion funnel — the EP1 business metric |
| Settings / profile / MFA | auth-service | |

---

## Data layer

| Store | Deployment | Used by |
|-------|-----------|---------|
| PostgreSQL 15 | Cloud SQL | auth-service, account-service, payment-service, admin-service |
| MongoDB | In-cluster StatefulSet + PVC | chat-service |
| Redis | In-cluster | account-service (cache) |
| Kafka | Strimzi (in-cluster) | payment-service → ledger-worker, rewards-service |

Cloud SQL rather than in-cluster Postgres: Database Monitoring is an explicit EP1
pillar, and managed Postgres gives a far better DBM story — plus data survives pod
rescheduling.

---

## Architecture

```
[Browser]
    │  HTTPS  (RUM + Session Replay)
    ▼
[frontend]  ──── JWT ───▶ [auth-service] ──▶ Postgres
    │
    ├──────────────────▶ [account-service] ──▶ Postgres / Redis
    │                             │
    │                             └──────────▶ [partner-mock]  (FX rates)
    │
    ├──────────────────▶ [payment-service] ──▶ Postgres
    │                             │
    │                             ├── Kafka ─▶ [ledger-worker]  ──▶ Postgres
    │                             ├── Kafka ─▶ [rewards-service]
    │                             └──────────▶ [partner-mock]  (BI FAST rail)
    │
    ├──────────────────▶ [biller-service] ───▶ [partner-mock]  (billers)
    │
    ├──────────────────▶ [admin-service] ────▶ Postgres
    │
    └──────────────────▶ [chat-service] ─────▶ MongoDB
                                  │  internal only, no Ingress
                                  ▼
                            [ai-agent] ──────▶ LLM provider
```

---

## Infrastructure

- **GCP project:** `datadog-ese-sandbox`
- **Region:** `asia-southeast2` (Jakarta)
- **GKE Standard** — not Autopilot; Cloud Network Monitoring and Universal Service
  Monitoring need agent privileges Autopilot restricts
- **Artifact Registry** for all service images
- **tfstate:** `gs://ctf-tfstate-agung/nusabank-*`
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
│   ├── infra/             # GKE, node pool, Artifact Registry, Cloud SQL
│   ├── k8s/               # Datadog Operator, namespace, secrets
│   └── datadog/           # Dashboards, monitors, SLOs, Synthetics — observability as code
├── services/              # All 12 services
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
