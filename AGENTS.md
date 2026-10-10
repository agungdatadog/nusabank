# AGENTS.md — Nusa Bank Datadog FSI Demo

> Canonical project instructions shared by all coding agents. `CLAUDE.md` is a symlink to this file.

**Nusa Bank** is a fictional Indonesian internet bank. It is the single running
application behind a four-episode Datadog webinar series for financial services.
See [README.md](./README.md) for the service list, feature map and architecture.

**EP1 air date: 29 October 2026.** Timeline pressure is real — the binding
constraint is *traffic history*, not code volume. Datadog SLOs, monitor baselines,
Watchdog, Error Tracking grouping and Session Replay all need accumulated calendar
time. Therefore: **deploy early and keep traffic running**, even when services are
still thin. Never take the environment down to "finish a service properly".

---

## Rules that always apply

### API first
- All inter-service API contracts live in **`catalog/openapi.yaml`**. Change the
  contract there *before* writing the implementation.
- Request/response shapes in code must match the spec exactly.
- Kafka event payloads are part of the contract too: they live in the same file
  under `components/schemas`, tagged with `x-kafka-topic`.

### Database per service
- Each service owns its database and DB user (map in [README.md](./README.md#data-layer)).
  Never query, join or write another service's database — use its API or its events.
- `ledger-worker` is the source of truth for journals; `account-service` balances are
  a projection of `ledger.posted.v1`. Reserve funds with an account-service *hold*
  before calling any rail.
- Money is a decimal **string** plus ISO currency (`"1500000"`, `"IDR"`) — never a float.

### This is a demo, and it must look credible on screen
- Realistic Indonesian data: IDR as primary currency, names, Jakarta addresses,
  16-digit account numbers, plausible balances. Avoid `foo` / `test123` / `Lorem`.
- Multi-currency products (IDR / USD / JPY) are part of the demo surface.
- No real bank's branding, product names, logos, colours or marketing copy for
  Nusa Bank itself. `BI FAST` and `SKN` are fine — Bank Indonesia's public schemes.
- Real destination banks, e-wallets and billers (BCA, GoPay, Telkomsel, PLN…) are
  shown by name as destinations, without logos. Failure scenarios may name them.

### Baseline must be healthy
- The application's **default state is healthy**. All demo failure scenarios are
  **OFF by default**, toggled explicitly via `partner-mock` config or
  `tools/scenarios/`.
- Never commit a permanently-degraded code path. A noisy baseline destroys EP1,
  whose entire premise is a clean "complete picture".
- Injected failures are latency, errors, N+1 queries, memory pressure, queue lag.
  Never anything that destroys data or is genuinely exploitable.

### Datadog conventions
- `DD_SERVICE` is `nusabank-<service>` (e.g. `nusabank-payment`), `DD_ENV=demo`.
- Do **not** hand-write envs the Admission Controller injects:
  `DD_AGENT_HOST`, `DD_ENV`, `DD_SERVICE`, `DD_VERSION`, `DD_ENTITY_ID`.
- `DD_TRACE_ANALYTICS_ENABLED` is deprecated — never use it.
- Unified service tagging on every service: `service`, `env`, `version`.
- Dashboards, monitors, SLOs and Synthetics are **code**, in `terraform/datadog/`.
  Nothing configured only through the UI — it must survive a rebuild.
- Logs are JSON with `dd.trace_id` / `dd.span_id` correlation.

### Kubernetes
- Namespace `nusabank`. Labels: `app`, `app.kubernetes.io/name`, `tags.datadoghq.com/{service,env,version}`.
- Container image tags are **pinned versions** — never `latest`.
- Every service declares resource requests/limits, liveness and readiness probes.
- Stateful data uses PVC or Cloud SQL — **never `emptyDir`**. An earlier project
  lost all Postgres data to `emptyDir` on pod rescheduling.

### Secrets
- Never hardcode secrets, API keys or passwords in source. Use Secret Manager,
  K8s Secrets or env vars.
- `JWT_SECRET` is shared config across auth/account/payment/admin.
- The repo is private, but treat it as if it will be public one day: no real
  credentials in commits, ever.

### Error handling
- Database failure → 500
- Malformed request body → 400
- Missing/invalid auth → 401
- Downstream service or partner failure → 502 / 503, with the partner named in the
  log and span so EP2's root-cause narrative works

### Comments
- Concise, 1–3 sentences. English or Indonesian, mixed is fine.
- Comment *why*, not *what*.

---

## Episode layering

The app is complete before EP1. Per-episode work is Datadog configuration and demo
scenarios, tracked in `docs/episodes/`.

| Episode | What gets added |
|---------|----------------|
| EP1 | Business metrics, business↔tech dashboards, Synthetics, healthy baseline |
| EP2 | Source maps + Error Tracking, Profiler everywhere, `partner-mock` failure scenarios |
| EP3 | SLOs as code, Software Catalog (`entity.datadog.yaml`), On-Call, Incident Management, Workflow Automation |
| EP4 | Multi-step `ai-agent`, LLM evaluations, AI Guard, token cost tracking |

When adding anything, ask which episode it serves. Work that serves no episode is
out of scope.

---

## What not to do

- Do not take the environment offline for refactors — traffic history is the
  scarcest resource.
- Do not configure Datadog resources only in the UI.
- Do not copy a real bank's branding or UI assets.
- Do not embed genuinely exploitable vulnerabilities (RCE, real data exfiltration).
- Do not use `latest` image tags or `emptyDir` for data.
