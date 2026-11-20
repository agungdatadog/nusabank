# EP2 — UNDERSTAND & ACT: the GoPay game day

**Framing.** Nusa Bank runs resilience game days: we deliberately break a partner and
prove we detect it, understand it and recover — the operational-resilience drills OJK
expects from Indonesian banks. On stage, Bits AI finding the injected fault is a feature:
the investigation reaches the true cause on its own.

**Scenario.** `ppob-gopay-errors` — 40% of GoPay calls through the PPOB aggregator fail
with 503. One partner breaks; every other biller stays healthy. Expires on its own after
3 hours (partner-mock default).

## Before going live
- [ ] Jakarta daytime, so load-generator traffic is high (night is ~8% of peak).
- [ ] Baseline green: all `[Nusa Bank]` monitors OK, no scenario enabled, `STATEMENT_COUNTERPARTY` false.
- [ ] Datadog GitHub integration has access to `agungdatadog/nusabank` (Bits Code needs it to open a PR).
- [ ] Fresh **incognito** window logged in as a demo customer (clean RUM session, latest frontend).
- [ ] Review Bits Investigation memories from rehearsals; remove stale ones.
- [ ] Bits.md pasted from `docs/bits/bits.md`.
- [ ] **Investigate with Bits** enabled on the drill monitors (UI only: monitor → Edit →
      Configure notifications & automations, or Bits Investigation → Monitors → Auto-Investigate).
      Needed on "Biller … is failing" (GoPay drill), "Rail … is failing" (BI FAST, Part 2) and
      "Slow transfer submission (p95)" / "Slow e-Statement download (p95)" (Part 3);
      a monitor re-created by Terraform loses it.
- [ ] Start the drill ~15 min before the segment so the monitor has alerted:
  ```bash
  kubectl port-forward -n nusabank svc/partner-mock 8080:8080 &
  curl -s -X PUT localhost:8080/__scenarios/ppob-gopay-errors -H 'Content-Type: application/json' \
    -d '{"target":"ppob","biller_code":"gopay","enabled":true,"error_rate":0.4,"error_status":503}'
  ```

## Flow on stage
| # | Moment | Datadog | Talking point |
|---|--------|---------|---------------|
| 1 | "A customer complains GoPay top-up fails" | RUM → Session Replay of the failed top-up (`@usr.id:<CIF>`) | See exactly what the customer saw |
| 2 | Is it widespread? | Error Tracking issue "GoPay sedang gangguan…" — users, sessions, `partner:ppob:gopay` | From one complaint to impact |
| 3 | Is it us? | APM `nusabank-biller` → outbound `ppob.request` to `ppob-gopay` failing; other billers green | Blast radius: one partner |
| 4 | How bad? | SLO "PPOB billers available (per biller)" burning for GoPay only; monitor "Biller … is failing" | Reliability in business terms |
| 5 | Root cause, fast | Bits AI investigation from the monitor | Partner 503s, money safe, and it even finds the game-day injector |
| 6 | Act | Incident declared, on-call paged, runbook `docs/runbooks/partner-outage.md` | *(On-Call / Incident / Workflow — still to build)* |
| 7 | Recover | Disable the scenario; monitor recovers, SLO stops burning | Prove the fix |

End the drill: `curl -s -X DELETE localhost:8080/__scenarios` (resets every scenario).

## Part 2 — BI FAST: Datadog switches the rail off, a person switches it back on

**Scenario.** `bifast-errors` — 30% of BI FAST calls fail with 503. When the monitor
"Rail bifast is failing" alerts, the workflow **[Nusa Bank] Nonaktifkan BI FAST saat gangguan**
(`terraform/datadog/workflows.tf`) takes BI FAST out of service: customers see it greyed out
with a banner and SKN preselected, so they stop failing at the partner. Re-enabling is a
human decision, made once the monitor has recovered.

Setup, ~10 min before the segment (after Part 1, or on its own):
```bash
kubectl port-forward -n nusabank svc/partner-mock 8080:8080 &
curl -s -X PUT localhost:8080/__scenarios/bifast-errors -H 'Content-Type: application/json' \
  -d '{"target":"bifast","enabled":true,"error_rate":0.3,"error_status":503}'
```
The monitor alerts within ~2 minutes and the workflow runs immediately (check
Workflow Automation → the workflow → Runs). Keep a second browser on `/ops` → **Rail**.

| # | Moment | Datadog / app | Talking point |
|---|--------|---------------|---------------|
| 1 | BI FAST transfers start failing | Monitor "Rail bifast is failing", `partner.request` errors on `nusabank-payment` → `bifast` | One partner, our code is healthy |
| 2 | Within a minute, BI FAST is off | Workflow run (monitor trigger → PUT `/api/admin/rails/BIFAST/availability` → change event) | Automation acts in seconds, not when someone reads the page |
| 3 | What customers see now | `/transfer`: BI FAST struck through, banner, SKN selected; Session Replay before vs after | Customers are redirected instead of failing |
| 4 | Proof it was a deliberate change | Change Tracking on `nusabank-payment` ("BI FAST dinonaktifkan otomatis"); `/ops` → Audit Log `ops.otomasi RAIL_DISABLE` | Every automated action is auditable — OJK cares |
| 5 | The partner recovers | Disable the scenario; the monitor recovers (SKN's name check still calls BI FAST, so its error rate keeps reporting) | We know it's safe before we switch back |
| 6 | A person switches it back | `/ops` → Rail → **Aktifkan kembali**, or run **[Nusa Bank] Pulihkan BI FAST** | Machines switch off, people switch on |
| 7 | Optional | `/ops` → Transfer: retry the transfers that failed `RAIL_UNAVAILABLE` in the first minutes | Close the loop for affected customers |

End: `curl -s -X DELETE localhost:8080/__scenarios`, then make sure `/ops` → Rail shows BI FAST
**Aktif**. A disabled rail re-enables itself after 2 hours regardless, so a forgotten switch
cannot poison the baseline for long.

## Part 3 — Our own bug: Bits finds it, Bits Code fixes it

**Scenario.** Not a partner this time. account-service ships an e-Statement feature behind a flag,
`STATEMENT_COUNTERPARTY` ("Rekening Lawan": the other account on each intrabank transfer). Its
lookup runs one query per statement row, on `transactions.reference`, which has no index: an N+1
of sequential scans. e-Statements slow down, and because `indowebinar-pg-core` is shared,
**BI FAST and intrabank transfers slow down with them** (noisy neighbour). Rehearsal 2026-11-20,
daytime traffic: statement p95 0.09 s → 1.6 s and transfer submission p95 0.23 s → 5.4 s within
five minutes; both back to baseline about two minutes after switching off. DBM shows the query at
1–2 s per call, all CPU, and ~1,900 calls in nine minutes.

Setup, ~15 min before the segment (each switch is a ~1 min rolling restart of account-service,
recorded by Datadog as a deployment):
```bash
tools/scenarios/estatement-counterparty.sh on
```
Monitors that turn red: **Slow e-Statement download (p95)** and **Slow transfer submission (p95)**.
Enable **Investigate with Bits** on both (UI only, see the checklist above).

| # | Moment | Datadog | Talking point |
|---|--------|---------|---------------|
| 1 | "Transfers are slow" | Monitor "Slow transfer submission (p95)"; APM `nusabank-payment` latency, partner spans healthy | Not a partner this time |
| 2 | Where does the time go? | Trace: payment's database spans slow on `pg-core`; DBM → `indowebinar-pg-core` load by service | The database is busy, and payment isn't the one keeping it busy |
| 3 | Who is it? | DBM → `indowebinar-pg-core`, database `account`: top query `SELECT account_number FROM transactions WHERE reference = ? AND account_number <> ? LIMIT ?`, caller `nusabank-account` 0.1.5, waiting on CPU; samples link to the trace | Noisy neighbour, found in minutes |
| 4 | What changed? | Change Tracking on `nusabank-account`: the flag rollout right before the slowdown | Every regression starts with a change |
| 5 | Root cause in code | Bits investigation → `StatementService.counterpartyOf`, one query per row (`AccountRepository.counterpartyAccount`) | From alert to file and line |
| 6 | Fix it | **Bits Code** proposes the change (one batched query instead of one per row, and an index on `reference`) and opens a PR | AI that writes the fix, a human reviews it |
| 7 | Recover | `tools/scenarios/estatement-counterparty.sh off`; both monitors recover | Roll back first, ship the fix through review |

**Do not merge Bits Code's PR** after a rehearsal: it removes the bug the drill depends on. Close it,
or keep it open to show on stage. End: `tools/scenarios/estatement-counterparty.sh off`, then check
`kubectl -n nusabank get deploy account-service -o yaml | grep -A1 STATEMENT_COUNTERPARTY` shows `false`.

## Not ready yet
- On-Call schedules and monitor notification routing (monitors notify nobody today; the BI FAST
  monitor's only handle is the workflow).
- Incident Management settings; the workflows record change events but don't declare an incident.
