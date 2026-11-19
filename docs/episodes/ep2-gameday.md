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

## Not ready yet
- On-Call schedules and monitor notification routing (monitors notify nobody today).
- Incident Management settings and a recovery Workflow.
