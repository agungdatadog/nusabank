# Postmortem: {{incident.title}}

{{incident.card}}

| | |
|---|---|
| Severity | {{incident.severity}} |
| Commander | {{incident.commander}} |
| Detected | {{incident.detected}} |
| Resolved | {{incident.resolved}} |
| Time to detect | {{incident.time_to_detect}} |
| Time to resolve | {{incident.time_to_resolve}} |
| Customer impact | {{incident.customer_impact_duration}} |

## Summary
{{incident.ai_issue}}

## Customer impact
{{incident.customer_impact}}

## Partner and blast radius
Which partner failed (`peer.service`), which products and customers were affected, which
partners stayed healthy. Link the trace view grouped by `peer.service` and the per-partner SLO.

## Money
Holds placed and released, payments left PENDING and how they settled. Confirm no ledger
journal was posted for a failed partner call.

## Root cause
{{incident.root_cause}}

## Timeline
{{incident.timeline}}

## Contributing factors
{{incident.ai_contributing_factors}}

## Follow-ups
{{incident.follow_ups}}
- [ ] Partner's own RCA requested
- [ ] Customer communication reviewed with Customer Care
- [ ] Monitor thresholds and runbook still right?
