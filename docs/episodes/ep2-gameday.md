# EP2 — UNDERSTAND & ACT: game day runbook

**Framing.** Nusa Bank runs resilience game days: we deliberately break a partner and
prove we detect it, understand it and recover — the operational-resilience drills OJK
expects from Indonesian banks. On stage, Bits AI finding the injected fault is a feature:
the investigation reaches the true cause on its own. **Part 3** is the other kind of incident:
a bug in our own code, which Bits traces to the line and Bits Code fixes.

## Scenarios

The live show runs **Parts 1–3**; the rest are spares for rehearsals, Q&A or a
different story. Click an ID for its flow. Source of truth: the `catalog` in
`services/partner-mock/scenarios.go` (API in `catalog/openapi.yaml` → `/__scenarios`).
All are OFF by default and switch themselves off after 3 hours unless the body sets `expires_at`.

| ID | Partner | Caller in APM | What breaks | Use |
|----|---------|---------------|-------------|-----|
| [`ppob-gopay-errors`](#ppob-gopay-errors) | PPOB → GoPay | `nusabank-biller` | 40% of calls 503 | **Part 1** — one biller breaks, the rest stay healthy |
| [`bifast-errors`](#bifast-errors) | BI FAST | `nusabank-payment` | 30% of calls 503 | **Part 2** — workflow switches the rail off, a person switches it back on |
| [`estatement-counterparty`](#estatement-counterparty) | — (our code) | `nusabank-account` → `nusabank-payment` | N+1 query on shared `pg-core`: e-Statement and transfers slow | **Part 3** — Bits finds the bug, Bits Code proposes the fix |
| [`ppob-pln-slow`](#ppob-pln-slow) | PPOB → PLN | `nusabank-biller` | +5 s latency | Spare — one biller slow, no errors |
| [`ppob-aggregator-down`](#ppob-aggregator-down) | Whole PPOB aggregator | `nusabank-biller` | 100% of calls 503 | Spare — every biller at once, wide blast radius |
| [`bifast-timeout`](#bifast-timeout) | BI FAST | `nusabank-payment` | +8 s latency | Spare — slow transfers that still succeed |
| [`skn-settlement-delay`](#skn-settlement-delay) | SKN | `nusabank-payment` | Settlement window +30 min | Spare — late money, no errors at all |
| [`credit-bureau-slow`](#credit-bureau-slow) | Credit bureau | `nusabank-loan` | +12 s latency (past the 8 s timeout) | Spare — loan applications fail with timeouts |
| [`fx-feed-down`](#fx-feed-down) | FX rate feed | `nusabank-account` | 100% of calls 503 | Spare — USD/JPY rates unavailable |
| [`credential-stuffing`](#credential-stuffing) | — (attack traffic) | `nusabank-auth` | 2 bad logins/s for 12 min | Better suited to EP3 (PROTECT) |

### Switching scenarios
```bash
kubectl port-forward -n nusabank svc/partner-mock 8080:8080 &
S=localhost:8080/__scenarios; J='Content-Type: application/json'

curl -s $S                 # what is on, and when it expires
curl -s -X DELETE $S       # everything off — healthy baseline
```
A PUT **replaces** the scenario, so always send the full body from the flow below — `target`
is required and fields you leave out are cleared. Tune in the body: `latency_ms`, `error_rate`
(0–1), `error_status` (500, 503 or 504 — 504 shows as `PARTNER_TIMEOUT`), `expires_at`
(RFC 3339). Scenarios on the same partner stack: the highest latency wins, then each error
rate is rolled.

Links in the flow tables open the US1 org (`app.datadoghq.com`) and the demo app. They are
searches by name, service or query rather than IDs, so they survive a Terraform rebuild —
log in to the demo org first.

## Before going live
- [ ] Jakarta daytime, so load-generator traffic is high (night is ~8% of peak).
- [ ] Baseline green: all `[Nusa Bank]` monitors OK, no scenario enabled (`curl -s $S`), and
      account-service's `STATEMENT_COUNTERPARTY` is `false`.
- [ ] Datadog GitHub integration can reach `agungdatadog/nusabank` (Bits Code opens its PR there).
- [ ] Fresh **incognito** window logged in as a demo customer (clean RUM session, latest frontend).
- [ ] Review Bits Investigation memories from rehearsals; remove stale ones.
- [ ] Bits.md pasted from `docs/bits/bits.md`.
- [ ] **Investigate with Bits** enabled on the drill monitors (UI only: monitor → Edit →
      Configure notifications & automations, or Bits Investigation → Monitors → Auto-Investigate).
      Needed on "Biller … is failing" (Part 1), "Rail … is failing" (Part 2), and
      "Slow transfer submission (p95)" + "Slow e-Statement download (p95)" (Part 3);
      a monitor re-created by Terraform loses it.

---

<a id="ppob-gopay-errors"></a>
## Part 1 — `ppob-gopay-errors`: GoPay is failing

40% of GoPay calls through the PPOB aggregator fail with 503. One partner breaks; every
other biller stays healthy.

Start ~15 min before the segment so the monitor has alerted:
```bash
curl -s -X PUT $S/ppob-gopay-errors -H "$J" \
  -d '{"target":"ppob","biller_code":"gopay","enabled":true,"error_rate":0.4,"error_status":503}'
```

| # | Moment | Do & click | Datadog | Talking point | Link |
|---|--------|------------|---------|---------------|------|
| 1 | "A customer complains GoPay top-up fails" | Open Session Replay → search `@usr.id:<CIF>` → open the latest session → **Play**, pause on the GoPay error toast | RUM → Session Replay of the failed top-up (`@usr.id:<CIF>`) | See exactly what the customer saw | [Session Replay](https://app.datadoghq.com/rum/sessions?query=service%3Anusabank-frontend%20env%3Ademo%20%40session.has_replay%3Atrue) |
| 2 | Is it widespread? | From the replay's error event click through to the Error Tracking issue → show the Users / Sessions counts and the `partner` tag | Error Tracking issue "GoPay sedang gangguan…" — users, sessions, `partner:ppob:gopay` | From one complaint to impact | [Error Tracking](https://app.datadoghq.com/error-tracking?query=service%3Anusabank-biller%20env%3Ademo) |
| 3 | Is it us? | Open Traces → **Group by** `peer.service` → click the red `ppob-gopay` row → open one error trace and expand the `ppob.request` span | APM `nusabank-biller` → outbound `ppob.request` to `ppob-gopay` failing; other billers green | Blast radius: one partner | [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-biller%20operation_name%3Appob.request%20env%3Ademo) |
| 4 | How bad? | Open the SLO → switch to the per-biller view → point at GoPay's budget dropping; then open the alerting monitor | SLO "PPOB billers available (per biller)" burning for GoPay only; monitor "Biller … is failing" | Reliability in business terms | [SLO](https://app.datadoghq.com/slo/manage?query=PPOB%20billers%20available) · [Monitor](https://app.datadoghq.com/monitors/manage?q=Biller%20is%20failing) |
| 5 | Root cause, fast | On the alerting monitor click the Bits investigation → scroll through its steps → stop on the conclusion | Bits AI investigation from the monitor | Partner 503s, money safe, and it even finds the game-day injector | [Monitor → Bits](https://app.datadoghq.com/monitors/manage?q=Biller%20is%20failing) |
| 6 | Act | Open Incidents → **Declare Incident** → link the monitor and runbook *(manual today)* | Incident declared, on-call paged, runbook `docs/runbooks/partner-outage.md` | *(On-Call / Incident / Workflow — still to build)* | [Incidents](https://app.datadoghq.com/incidents) |
| 7 | Recover | Run `curl -s -X DELETE $S` → back on the SLO/monitor, wait ~2 min for green | Disable the scenario; monitor recovers, SLO stops burning | Prove the fix | [SLO](https://app.datadoghq.com/slo/manage?query=PPOB%20billers%20available) |

End: `curl -s -X DELETE $S`.

<a id="bifast-errors"></a>
## Part 2 — `bifast-errors`: Datadog switches the rail off, a person switches it back on

30% of BI FAST calls fail with 503. When the monitor "Rail bifast is failing" alerts, the
workflow **[Nusa Bank] Nonaktifkan BI FAST saat gangguan** (`terraform/datadog/workflows.tf`)
takes BI FAST out of service: customers see it greyed out with a banner and SKN preselected,
so they stop failing at the partner. Re-enabling is a human decision, made once the monitor
has recovered.

Start ~10 min before the segment (after Part 1, or on its own):
```bash
curl -s -X PUT $S/bifast-errors -H "$J" \
  -d '{"target":"bifast","enabled":true,"error_rate":0.3,"error_status":503}'
```
The monitor alerts within ~2 minutes and the workflow runs immediately (check
Workflow Automation → the workflow → Runs). Keep a second browser on `/ops` → **Rail**.

| # | Moment | Do & click | Datadog / app | Talking point | Link |
|---|--------|------------|---------------|---------------|------|
| 1 | BI FAST transfers start failing | Open the alerting monitor "Rail bifast is failing" → click **Traces** → open one failed `partner.request` span to `bifast` | Monitor "Rail bifast is failing", `partner.request` errors on `nusabank-payment` → `bifast` | One partner, our code is healthy | [Monitor](https://app.datadoghq.com/monitors/manage?q=Rail%20is%20failing) · [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-payment%20operation_name%3Apartner.request%20peer.service%3Abifast%20env%3Ademo) |
| 2 | Within a minute, BI FAST is off | Open Workflows → **[Nusa Bank] Nonaktifkan BI FAST saat gangguan** → **Runs** → click the latest run, walk the steps left to right | Workflow run (monitor trigger → PUT `/api/admin/rails/BIFAST/availability` → change event) | Automation acts in seconds, not when someone reads the page | [Workflows](https://app.datadoghq.com/workflow) |
| 3 | What customers see now | Switch to the customer browser → reload `/transfer` → point at BI FAST struck through, the banner and SKN preselected | `/transfer`: BI FAST struck through, banner, SKN selected; Session Replay before vs after | Customers are redirected instead of failing | [/transfer](https://136-69-32-40.sslip.io/transfer) · [Session Replay](https://app.datadoghq.com/rum/sessions?query=service%3Anusabank-frontend%20env%3Ademo%20%40session.has_replay%3Atrue) |
| 4 | Proof it was a deliberate change | Open Events → filter `service:nusabank-payment` → click "BI FAST dinonaktifkan otomatis"; then `/ops` → **Audit Log** → find `RAIL_DISABLE` | Change Tracking on `nusabank-payment` ("BI FAST dinonaktifkan otomatis"); `/ops` → Audit Log `ops.otomasi RAIL_DISABLE` | Every automated action is auditable — OJK cares | [Change events](https://app.datadoghq.com/event/explorer?query=service%3Anusabank-payment%20env%3Ademo) · [/ops](https://136-69-32-40.sslip.io/ops) |
| 5 | The partner recovers | Run `curl -s -X DELETE $S` → keep the monitor open until it turns OK | Disable the scenario; the monitor recovers (SKN's name check still calls BI FAST, so its error rate keeps reporting) | We know it's safe before we switch back | [Monitor](https://app.datadoghq.com/monitors/manage?q=Rail%20is%20failing) |
| 6 | A person switches it back | `/ops` → **Rail** → click **Aktifkan kembali** on BI FAST (or Workflows → **[Nusa Bank] Pulihkan BI FAST** → **Run**) | `/ops` → Rail → **Aktifkan kembali**, or run **[Nusa Bank] Pulihkan BI FAST** | Machines switch off, people switch on | [/ops](https://136-69-32-40.sslip.io/ops) · [Workflows](https://app.datadoghq.com/workflow) |
| 7 | Optional | `/ops` → **Transfer** → filter `RAIL_UNAVAILABLE` → retry one transfer | `/ops` → Transfer: retry the transfers that failed `RAIL_UNAVAILABLE` in the first minutes | Close the loop for affected customers | [/ops](https://136-69-32-40.sslip.io/ops) |

End: `curl -s -X DELETE $S`, then make sure `/ops` → Rail shows BI FAST **Aktif**. A disabled
rail re-enables itself after 2 hours regardless, so a forgotten switch cannot poison the
baseline for long.

<a id="estatement-counterparty"></a>
## Part 3 — `estatement-counterparty`: our own bug, fixed by Bits Code

Not a partner this time. account-service ships an e-Statement column behind the flag
`STATEMENT_COUNTERPARTY` ("Rekening Lawan": the other account on each intrabank transfer). Its
lookup runs one query per statement row on `transactions.reference`, which has no index — an
N+1 of sequential scans. e-Statements slow down, and because `indowebinar-pg-core` is shared with
payment and ledger, **transfers slow down with them** (noisy neighbour).

Rehearsed 2026-11-20, daytime traffic: e-Statement p95 0.09 s → 1.6 s and transfer submission p95
0.23 s → 5.4 s within five minutes; both back to baseline ~2 min after switching off. DBM showed the
query at 1–2 s per call, all CPU wait, ~1,900 calls in nine minutes.

Start ~15 min before the segment. Each switch is a ~1 min rolling restart of account-service,
which Datadog records as a deployment:
```bash
tools/scenarios/estatement-counterparty.sh on
```
Monitors that turn red: **Slow e-Statement download (p95)** (> 0.6 s) and **Slow transfer submission (p95)** (> 3 s).

| # | Moment | Do & click | Datadog | Talking point | Link |
|---|--------|------------|---------|---------------|------|
| 1 | "Transfers are slow" | Open the alerting "Slow transfer submission" monitor → click **Traces** → sort by duration, open the slowest | Monitor "Slow transfer submission (p95)"; APM `nusabank-payment` latency up, `partner.request` spans healthy | Not a partner this time | [Monitor](https://app.datadoghq.com/monitors/manage?q=Slow%20transfer%20submission) · [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-payment%20resource_name%3Apost_%2Fapi%2Ftransfers%20env%3Ademo) |
| 2 | Where does the time go? | In the flame graph, click the long Postgres spans; show `partner.request` is short | Trace: payment's own database spans are slow on `pg-core` | The database is busy, and payment isn't the one keeping it busy | [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-payment%20db.system%3Apostgresql%20env%3Ademo) |
| 3 | Who is it? | Open DBM → **Query Metrics** → host `indowebinar-pg-core` → sort by total time → click the top query → **Samples** → open one trace | DBM → `indowebinar-pg-core`, database `account`: top query `SELECT account_number FROM transactions WHERE reference = ? AND account_number <> ? LIMIT ?`, caller `nusabank-account` 0.1.5, CPU wait; samples link to the trace | Noisy neighbour, found in minutes | [DBM](https://app.datadoghq.com/databases) |
| 4 | What changed? | Open Events → filter `service:nusabank-account` → click the deployment just before the slowdown | Change Tracking on `nusabank-account`: the rollout just before the slowdown; monitor "Slow e-Statement download (p95)" | Every regression starts with a change | [Change events](https://app.datadoghq.com/event/explorer?query=service%3Anusabank-account%20env%3Ademo) · [Monitor](https://app.datadoghq.com/monitors/manage?q=Slow%20e-Statement%20download) |
| 5 | Root cause in code | Open the "Slow e-Statement download" monitor → click the Bits investigation → scroll to the code finding | Bits investigation → `StatementService.counterpartyOf` calling `AccountRepository.counterpartyAccount` once per row | From alert to file and line | [Monitor → Bits](https://app.datadoghq.com/monitors/manage?q=Slow%20e-Statement%20download) |
| 6 | Fix it | In the investigation, start **Bits Code** on the finding → open the PR it creates → show the diff | **Bits Code** proposes the change — one batched lookup instead of one per row, plus an index on `reference` — and opens a PR | AI writes the fix, a human reviews it | — |
| 7 | Recover | Run `tools/scenarios/estatement-counterparty.sh off` → wait ~2 min on the monitors list for green | `tools/scenarios/estatement-counterparty.sh off`; both monitors recover | Roll back first, ship the fix through review | [Monitors](https://app.datadoghq.com/monitors/manage?q=Slow) |

**Don't merge Bits Code's PR** after a rehearsal: it removes the bug this drill depends on. Close it,
or leave it open to show on stage. End: `tools/scenarios/estatement-counterparty.sh off`, then
confirm `kubectl -n nusabank get deploy account-service -o jsonpath='{..env[?(@.name=="STATEMENT_COUNTERPARTY")].value}'`
prints `false`.

---

## Spare scenarios

Not rehearsed on stage yet — the flows below follow from the code and Terraform monitors;
confirm them in a rehearsal before relying on one live. End any of them with `curl -s -X DELETE $S`.

<a id="ppob-pln-slow"></a>
### `ppob-pln-slow` — PLN is slow, nothing fails
```bash
curl -s -X PUT $S/ppob-pln-slow -H "$J" -d '{"target":"ppob","biller_code":"pln","enabled":true,"latency_ms":5000}'
```
PLN answers after ~5 s, inside biller-service's 8 s timeout, so payments succeed — slowly.

| # | Moment | Do & click | Datadog | Talking point | Link |
|---|--------|------------|---------|---------------|------|
| 1 | Customers wait on PLN token purchases | Open Session Replay → pick a session with a PLN payment → **Play**, point at the spinner | RUM: long `POST /api/billers/payments` resource on PLN; Session Replay | Slow is the new down | [Session Replay](https://app.datadoghq.com/rum/sessions?query=service%3Anusabank-frontend%20env%3Ademo%20%40session.has_replay%3Atrue) |
| 2 | Which biller? | Open Traces → **Group by** `peer.service` → sort by p95 → click `ppob-pln` | Monitor "Biller ppob-pln is slow (p95)" (> 3 s); APM `nusabank-biller` → `ppob.request` latency by `peer.service` | One biller, not our code | [Monitor](https://app.datadoghq.com/monitors/manage?q=Biller%20is%20slow) · [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-biller%20operation_name%3Appob.request%20peer.service%3Appob-pln%20env%3Ademo) |
| 3 | Does it hurt the journey? | Open the "Slow bill payment" monitor, then the SLO → compare to before the scenario | Monitor "Slow bill payment (p95)" (> 4 s) and the "Top-up & bill payment: fast" SLO, if PLN is a big enough share of traffic | Partner latency becomes our latency | [Monitor](https://app.datadoghq.com/monitors/manage?q=Slow%20bill%20payment) · [SLO](https://app.datadoghq.com/slo/manage?query=Top-up%20%26%20bill%20payment) |

<a id="ppob-aggregator-down"></a>
### `ppob-aggregator-down` — the whole PPOB aggregator is down
```bash
curl -s -X PUT $S/ppob-aggregator-down -H "$J" -d '{"target":"ppob","enabled":true,"error_rate":1,"error_status":503}'
```
Every biller fails. Contrast with Part 1: same error, completely different blast radius.

| # | Moment | Do & click | Datadog | Talking point | Link |
|---|--------|------------|---------|---------------|------|
| 1 | All top-ups and bill payments fail | Open Monitors → search "Biller is failing" → point at every group red at once | "Biller … is failing" alerts for every `peer.service`; Error Tracking per biller | One upstream, many symptoms | [Monitors](https://app.datadoghq.com/monitors/manage?q=Biller%20is%20failing) · [Error Tracking](https://app.datadoghq.com/error-tracking?query=service%3Anusabank-biller%20env%3Ademo) |
| 2 | Common cause | Open Service Map → click `nusabank-biller` → show all `ppob-*` edges red | APM `nusabank-biller` → all `ppob-*` peers red together; Service Map | Group the alerts, find the shared dependency | [Service Map](https://app.datadoghq.com/apm/map?env=demo) · [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-biller%20operation_name%3Appob.request%20status%3Aerror%20env%3Ademo) |
| 3 | Business impact | Open SLOs → search "Nusa Bank" → click the "Top-up & bill payment: available" SLO, then the critical-journeys SLO | "Top-up & bill payment: available" SLO and the critical-journeys SLO burning; burn-rate alerts | Revenue journey down, not just a service | [SLOs](https://app.datadoghq.com/slo/manage?query=Nusa%20Bank) · [Burn alerts](https://app.datadoghq.com/monitors/manage?q=error%20budget%20burn) |

<a id="bifast-timeout"></a>
### `bifast-timeout` — BI FAST answers, but only after 8 s
```bash
curl -s -X PUT $S/bifast-timeout -H "$J" -d '{"target":"bifast","enabled":true,"latency_ms":8000}'
```
Payment-service waits up to 10 s for a rail, so transfers succeed after ~8 s — no errors, no
workflow trigger.

| # | Moment | Do & click | Datadog | Talking point | Link |
|---|--------|------------|---------|---------------|------|
| 1 | Transfers feel stuck | Open Session Replay of a transfer → **Play**, let the ~8 s wait run | RUM: long `POST /api/transfers`; Session Replay of the spinner | Customers notice before error rates do | [Session Replay](https://app.datadoghq.com/rum/sessions?query=service%3Anusabank-frontend%20env%3Ademo%20%40session.has_replay%3Atrue) |
| 2 | Where is the time? | Open Traces → sort by duration → open the slowest → click the `partner.request` span to `bifast` | Monitor "Rail bifast is slow (p95)" and "Slow transfer submission (p95)"; trace flame graph → `partner.request` to `bifast` | One span holds all the latency | [Monitors](https://app.datadoghq.com/monitors/manage?q=Slow%20transfer) · [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-payment%20operation_name%3Apartner.request%20peer.service%3Abifast%20env%3Ademo) |
| 3 | Why no auto-switch? | Open Workflows → show the rail workflow has no new run | The rail workflow only reacts to "Rail … is failing" | A slow partner is a human decision; set an `error_status: 504` variant to show the timeout path | [Workflows](https://app.datadoghq.com/workflow) |

<a id="skn-settlement-delay"></a>
### `skn-settlement-delay` — SKN settles 30 min late
```bash
curl -s -X PUT $S/skn-settlement-delay -H "$J" -d '{"target":"skn","enabled":true,"skn_window_delay_minutes":30}'
```
SKN accepts transfers normally but holds each clearing window 30 min longer, so transfers stay
`PROCESSING` past their `expected_settlement_at`. Nothing errors and no monitor covers it.

| # | Moment | Do & click | Datadog / app | Talking point | Link |
|---|--------|------------|---------------|---------------|------|
| 1 | "My SKN transfer still hasn't arrived" | `/ops` → **Transfer** → filter rail SKN, status `PROCESSING` → compare `expected_settlement_at` with now | `/ops` → Transfer filtered to SKN: `PROCESSING` past the expected time | Healthy APM, unhappy customer | [/ops](https://136-69-32-40.sslip.io/ops) |
| 2 | Find it | Open Logs → look at the gaps between "SKN window applied" lines | Logs: `"SKN window applied"` lines from `nusabank-payment` arriving late | The signal is in the business events | [Logs](https://app.datadoghq.com/logs?query=service%3Anusabank-payment%20%22SKN%20window%20applied%22%20env%3Ademo) |
| 3 | Close the gap | Nothing to click — say what monitor you would add | Good prompt for a business monitor (settlement lag) — not built yet | Not every outage is a 5xx | — |

<a id="credit-bureau-slow"></a>
### `credit-bureau-slow` — the credit bureau stalls
```bash
curl -s -X PUT $S/credit-bureau-slow -H "$J" -d '{"target":"credit-bureau","enabled":true,"latency_ms":12000}'
```
12 s is past loan-service's 8 s read timeout, so every credit check ends in 503
`PARTNER_TIMEOUT` ("Pemeriksaan kredit sedang tidak tersedia…"); the application is saved and
can be resubmitted. Lower `latency_ms` to ~7000 for a slow-but-working variant.

| # | Moment | Do & click | Datadog | Talking point | Link |
|---|--------|------------|---------|---------------|------|
| 1 | Loan applications fail after 8 s | Customer browser → submit a loan application → wait ~8 s for the error; then open Session Replay of it | RUM / Error Tracking on the loan application; Session Replay | Long wait, then an error | [Session Replay](https://app.datadoghq.com/rum/sessions?query=service%3Anusabank-frontend%20env%3Ademo%20%40session.has_replay%3Atrue) · [Error Tracking](https://app.datadoghq.com/error-tracking?query=service%3Anusabank-loan%20env%3Ademo) |
| 2 | Which partner? | Open Traces → open a failed trace → click the `partner.request` span to `credit-bureau` | Monitor "Credit bureau is slow (p95)" (> 6 s over 30 min — alerts slowly by design); APM `nusabank-loan` → `partner.request` to `credit-bureau` | Service Map: loan-service → credit-bureau | [Monitor](https://app.datadoghq.com/monitors/manage?q=Credit%20bureau%20is%20slow) · [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-loan%20operation_name%3Apartner.request%20env%3Ademo) |
| 3 | Is the rest fine? | Open Service Map → click `nusabank-loan` → show only its bureau edge is red | Login, balance, transfers green | Contained blast radius | [Service Map](https://app.datadoghq.com/apm/map?env=demo) |

<a id="fx-feed-down"></a>
### `fx-feed-down` — no FX rates
```bash
curl -s -X PUT $S/fx-feed-down -H "$J" -d '{"target":"fx","enabled":true,"error_rate":1,"error_status":503}'
```
Account-service caches rates in Redis for 60 s, so the outage shows up to a minute after
enabling. Then the rates endpoint returns 502 ("Kurs valas sedang tidak tersedia") and the
portfolio total drops USD/JPY products instead of failing the page. FX has no dedicated
monitor and no `partner.request` span, so the "Rail … is failing" monitor doesn't see it.

| # | Moment | Do & click | Datadog | Talking point | Link |
|---|--------|------------|---------|---------------|------|
| 1 | Customer's total balance looks wrong | Customer browser → open the account page → point at the total without USD/JPY; then open Logs | RUM / Session Replay on the account page; log `FX unavailable, total balance shown without foreign-currency products` | Graceful degradation, still visible | [Session Replay](https://app.datadoghq.com/rum/sessions?query=service%3Anusabank-frontend%20env%3Ademo%20%40session.has_replay%3Atrue) · [Logs](https://app.datadoghq.com/logs?query=service%3Anusabank-account%20%22FX%20unavailable%22%20env%3Ademo) |
| 2 | Find it | Open Traces → filter errors → open one → click the outbound call to `fx-gateway` | APM `nusabank-account` → outbound calls to `fx-gateway` failing; Error Tracking on the rates endpoint | The cache hid it for a minute | [Traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-account%20status%3Aerror%20env%3Ademo) · [Error Tracking](https://app.datadoghq.com/error-tracking?query=service%3Anusabank-account%20env%3Ademo) |

<a id="credential-stuffing"></a>
### `credential-stuffing` — slow attack on the login (EP3)
```bash
kubectl apply -f tools/scenarios/credential-stuffing.yaml    # start
kubectl delete -f tools/scenarios/credential-stuffing.yaml   # stop
```
A k6 job sends 2 logins/s with non-existent usernames for 12 min (hard stop at 20 min). No
real demo account is locked. Shows up on `nusabank-auth` as failed logins from one client
signature — App & API Protection / Cloud SIEM rather than this game day.

| # | Moment | Do & click | Datadog | Talking point | Link |
|---|--------|------------|---------|---------------|------|
| 1 | Failed logins pile up | Open login traces → filter errors → **Group by** `@http.useragent` → one client dominates | `nusabank-auth` `POST /api/auth/login` errors from one user agent | Many usernames, one attacker | [Login traces](https://app.datadoghq.com/apm/traces?query=service%3Anusabank-auth%20resource_name%3Apost_%2Fapi%2Fauth%2Flogin%20env%3Ademo) |
| 2 | Did Datadog flag it? | Open Security signals → filter `env:demo` → open the newest signal | Credential-stuffing / brute-force signal on the login | Detection without writing a rule | [Security signals](https://app.datadoghq.com/security?query=env%3Ademo) |

---

## Not ready yet
- On-Call schedules and monitor notification routing (monitors notify nobody today; the BI FAST
  monitor's only handle is the workflow).
- Incident Management settings; the workflows record change events but don't declare an incident.
- Scenario the README promises but nothing toggles yet: Kafka consumer lag behind a stale
  balance (DSM story).
