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
- [ ] Baseline green: all `[Nusa Bank]` monitors OK, no scenario enabled.
- [ ] Fresh **incognito** window logged in as a demo customer (clean RUM session, latest frontend).
- [ ] Review Bits Investigation memories from rehearsals; remove stale ones.
- [ ] Bits.md pasted from `docs/bits/bits.md`.
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

## Not ready yet
- On-Call schedules and monitor notification routing (monitors notify nobody today; the BI FAST
  monitor's only handle is the workflow).
- Incident Management settings; the workflows record change events but don't declare an incident.
