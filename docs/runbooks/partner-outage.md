# Runbook — partner outage (PPOB billers, BI FAST, SKN, credit bureau, FX)

Nusa Bank depends on external partners it cannot see inside. We only observe our own
outbound calls: `ppob.request` spans in `nusabank-biller` and `partner.request` spans in
`nusabank-payment` / `nusabank-loan`, tagged `peer.service` (`ppob-gopay`, `bifast`, `skn`,
`credit-bureau`, …). Traffic leaves the cluster through the partner gateways
`ppob-gateway`, `interbank-gateway`, `credit-bureau-gateway` and `fx-gateway`.

## 1. Confirm it is the partner, not us
- The failing span is the **outbound** call (`span.kind:client`) and the error is a 5xx or
  timeout from the partner. Our own server spans, database and Kafka are healthy.
- Blast radius: compare `peer.service` values. One biller failing while the others are
  green means the partner, not the aggregator or our biller-service.
- Check for a recent deploy of the calling service (Change Tracking). No deploy, partner
  errors only → treat as a partner incident.

## 2. Customer and money impact
- Funds are reserved with an account-service **hold** before any partner call.
  - Partner **503/500**: payment or transfer ends `FAILED`, the hold is released. No money moves.
  - Partner **timeout/504**: bill payment stays `PENDING` with the hold kept until the
    background check settles it; transfers end `FAILED RAIL_UNAVAILABLE` and can be retried.
- Size the impact: `nusabank.biller.payment.count{status:failed} by {biller}`,
  `nusabank.transfer.count{status:failed} by {rail}`, and the Error Tracking issue for
  affected users/sessions.

## 3. Act
1. Declare an incident (SEV-3 for one biller, SEV-2 for BI FAST or the whole aggregator).
   From the incident, page the team that owns the calling service (Digital Channels for
   billers, Payments for rails, Core Banking for the credit bureau).
2. Escalate to the partner's operations desk with the time window, error rate and a
   sample request ID from the span. *(Nusa Bank is fictional — no real contacts here.)*
3. Customer communication: tell Customer Care which product is disrupted and the message
   customers see; suggest an alternative e-wallet or rail (BI FAST down → SKN for large transfers).
4. Do **not** retry in a tight loop — partner outages get worse under retry storms.
5. BI FAST: Workflow Automation takes it out of service automatically when "Rail bifast is
   failing" alerts (customers are steered to SKN). Any rail can also be switched off by hand
   from `/ops` → Rail. A disabled rail re-enables itself after 2 hours.

## 4. Recover and verify
- The partner's error rate returns to baseline and the per-partner monitor recovers. BI FAST
  keeps reporting while switched off, because SKN's beneficiary-name check still uses it.
- Re-enable the rail from `/ops` → Rail (or the "Pulihkan BI FAST" workflow). Only after
  recovery: re-enabling into a live outage puts customers back on the failing rail.
- Transfers that ended `FAILED RAIL_UNAVAILABLE` are re-driven by operators from `/ops`.
- Note the SLO budget consumed (`PPOB billers available`, `Transfer rails available`) in
  the incident postmortem.
