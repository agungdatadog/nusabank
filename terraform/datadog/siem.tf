# Cloud SIEM: credential stuffing against the Nusa Bank login. auth-service logs every rejected
# login with the username and network.client.ip; many different usernames from one source in a
# short window is stuffing, not a customer mistyping. Bits Security Analyst triages the signal.
# Needs the Cloud SIEM index to receive `service:nusabank-auth "login rejected"` logs.
resource "datadog_security_monitoring_rule" "credential_stuffing" {
  name    = "[Nusa Bank] Credential stuffing on internet banking login"
  type    = "log_detection"
  enabled = true

  query {
    name            = "rejected_logins"
    query           = "service:nusabank-auth \"login rejected\""
    aggregation     = "cardinality"
    distinct_fields = ["@username"]
    group_by_fields = ["@network.client.ip"]
  }

  case {
    name      = "many usernames from one source"
    condition = "rejected_logins > 50"
    status    = "high"
  }

  options {
    evaluation_window   = 600
    keep_alive          = 1800
    max_signal_duration = 3600
  }

  message = <<-EOT
    ## Goal
    Detect credential stuffing: one source trying many different usernames against the Nusa Bank login.

    ## Strategy
    Count distinct `@username` values in rejected logins (`service:nusabank-auth "login rejected"`)
    per `@network.client.ip` over 10 minutes. More than 50 is far above a customer retrying a password.

    ## Triage and response
    1. Check whether any login from the same source succeeded (AAP traces: `@appsec.security_activity:business_logic.users.login.*`).
    2. Review the targeted usernames: real customers or a leaked list.
    3. If confirmed, block the source in App and API Protection and force a password reset for any account that logged in from it.
  EOT

  tags = ["team:nusabank-channels", "env:demo", "managed-by:terraform", "source:nusabank-auth", "tactic:TA0006-credential-access"]
}
