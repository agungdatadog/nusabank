#!/usr/bin/env bash
# Demo scenario (OFF by default): loan-service switches its amortisation schedule to AUDIT mode,
# which recomputes every row from the original principal at 1,000-digit precision. Results are
# identical to the rupiah; a KPR simulation goes from ~10 ms to seconds of CPU. Rolled out like
# a config release, so Change Tracking shows the deploy and Continuous Profiler shows the hotspot.
# Run:   bash tools/scenarios/loan-audit-schedule.sh on
# Stop:  bash tools/scenarios/loan-audit-schedule.sh off
set -euo pipefail

case "${1:-}" in
  on)  kubectl set env -n nusabank deployment/loan-service LOAN_SCHEDULE_MODE=AUDIT ;;
  off) kubectl set env -n nusabank deployment/loan-service LOAN_SCHEDULE_MODE- ;;
  *)   echo "usage: $0 on|off" >&2; exit 2 ;;
esac
kubectl rollout status -n nusabank deployment/loan-service --timeout=300s
