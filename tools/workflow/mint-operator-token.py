"""Mint the operator token that Datadog Workflow Automation uses to call admin-service.

Reads JWT_SECRET on stdin and prints a token on stdout, so neither touches disk or a terminal:

  gcloud secrets versions access latest --secret=indowebinar-jwt-secret \
    | python3 -I tools/workflow/mint-operator-token.py \
    | gcloud secrets versions add indowebinar-workflow-operator-token --data-file=-

Same HS256 contract as admin-service's JwtIssuer (role=operator, aud=nusabank), but long-lived:
the workflow cannot log in interactively. Rotate it by re-running; terraform/datadog reads the
latest version. Expiry is after EP3 so the token cannot outlive the series by much.
"""
import base64
import hashlib
import hmac
import json
import sys
import time
from datetime import datetime, timezone

EXPIRES = datetime(2027, 1, 31, tzinfo=timezone.utc)


def b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


secret = sys.stdin.read().strip().encode()
if not secret:
    sys.exit("JWT_SECRET expected on stdin")
now = int(time.time())
claims = {"sub": "ops.otomasi", "name": "Otomasi (Datadog Workflow)", "role": "operator",
          "iss": "nusabank-admin", "aud": "nusabank", "iat": now, "exp": int(EXPIRES.timestamp())}
head = b64(json.dumps({"alg": "HS256", "typ": "JWT"}).encode())
body = b64(json.dumps(claims, separators=(",", ":")).encode())
sig = b64(hmac.new(secret, f"{head}.{body}".encode(), hashlib.sha256).digest())
sys.stdout.write(f"{head}.{body}.{sig}")
