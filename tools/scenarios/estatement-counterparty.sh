#!/usr/bin/env bash
# Demo scenario (OFF by default): roll out the e-Statement "Rekening Lawan" flag on account-service.
# The new column looks up each transaction's counterparty with one unindexed query per row (an N+1),
# so e-Statement downloads slow down and pg-core load rises for account, payment and ledger alike.
# Bits Investigation traces it to StatementService; Bits Code proposes the fix.
# Run:   tools/scenarios/estatement-counterparty.sh on
# Stop:  tools/scenarios/estatement-counterparty.sh off
# Either way is a rolling restart of account-service (~1 min), which Datadog records as a deployment.
set -euo pipefail
case "${1:-}" in
  on)  value=true ;;
  off) value=false ;;
  *)   echo "usage: $0 on|off" >&2; exit 2 ;;
esac
kubectl -n nusabank set env deployment/account-service STATEMENT_COUNTERPARTY="$value"
kubectl -n nusabank rollout status deployment/account-service --timeout=5m
