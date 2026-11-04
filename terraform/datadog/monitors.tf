# Core monitors for EP1. Thresholds sit well above the healthy baseline (measured
# 2026-10-26..28) and well below what each partner-mock scenario injects, so a quiet
# baseline stays green and every demo scenario turns a monitor red. Messages name the
# partner or service so the EP2/EP3 root-cause story starts from the alert itself.
# No notification handle yet: alerts show in Monitors and on the dashboard.

locals {
  monitor_tags = ["team:nusabank", "env:demo", "managed-by:terraform"]
}

# ───────────── Service health: API error rate per runtime ─────────────

resource "datadog_monitor" "api_errors_java" {
  name    = "[Nusa Bank] High API error rate on {{service.name}} (Java)"
  type    = "query alert"
  query   = "sum(last_15m):100 * default_zero(sum:trace.servlet.request.errors{env:demo} by {service}.as_count()) / sum:trace.servlet.request.hits{env:demo} by {service}.as_count() > 10"
  message = <<-EOT
    More than {{threshold}}% of requests to **{{service.name}}** failed in the last 15 minutes ({{value}}%).
    Start at APM → {{service.name}} → Errors; traces carry usr.id (CIF) and partner.name when the cause is downstream.
  EOT
  monitor_thresholds {
    critical = 10
    warning  = 5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "api_errors_node" {
  name    = "[Nusa Bank] High API error rate on {{service.name}} (Node)"
  type    = "query alert"
  query   = "sum(last_15m):100 * default_zero(sum:trace.hono.request.errors{env:demo} by {service}.as_count()) / sum:trace.hono.request.hits{env:demo} by {service}.as_count() > 10"
  message = <<-EOT
    More than {{threshold}}% of requests to **{{service.name}}** failed in the last 15 minutes ({{value}}%).
    Start at APM → {{service.name}} → Errors; traces carry usr.id (CIF) and partner.name when the cause is downstream.
  EOT
  monitor_thresholds {
    critical = 10
    warning  = 5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "api_errors_payment" {
  name    = "[Nusa Bank] High error rate sending transfers (payment-service)"
  type    = "query alert"
  query   = "sum(last_15m):100 * default_zero(sum:trace.http.request.errors{service:nusabank-payment,resource_name:post_/api/transfers,env:demo}.as_count()) / sum:trace.http.request.hits{service:nusabank-payment,resource_name:post_/api/transfers,env:demo}.as_count() > 10"
  message = <<-EOT
    {{value}}% of transfers failed to send in the last 15 minutes. Check the BI FAST / SKN partner monitors — rail
    failures surface here as 502/503 with partner.name on the span and in the log.
  EOT
  monitor_thresholds {
    critical = 10
    warning  = 5
  }
  require_full_window = false
  tags                = concat(local.monitor_tags, ["service:nusabank-payment"])
}

# A pod killed mid-request never flushes its span, so OOM kills can hide from the trace error
# rate above; restarts are the infrastructure side of the same failure.
resource "datadog_monitor" "pod_restarts" {
  name    = "[Nusa Bank] {{service.name}} containers keep restarting"
  type    = "query alert"
  query   = "change(sum(last_10m),last_10m):sum:kubernetes.containers.restarts{kube_namespace:nusabank,env:demo} by {service} > 3"
  message = <<-EOT
    Containers of **{{service.name}}** restarted {{value}} times in the last 10 minutes. Customers on that service's
    journeys see failed requests while pods restart. Check the pod's last termination reason (OOMKilled, probe
    failures) and the service's most recent deployment.
  EOT
  monitor_thresholds {
    critical = 3
  }
  require_full_window = false
  tags                = local.monitor_tags
}

# ───────────── Customer-facing latency of the key flows ─────────────

resource "datadog_monitor" "latency_transfer" {
  name    = "[Nusa Bank] Slow transfer submission (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.http.request{service:nusabank-payment,resource_name:post_/api/transfers,env:demo} > 3"
  message = "Transfer submission p95 is {{value}}s (baseline ~0.1s). Look at BI FAST/SKN partner latency and the database spans in the trace."
  monitor_thresholds {
    critical = 3
    warning  = 1.5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "latency_bill_payment" {
  name    = "[Nusa Bank] Slow bill payment (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.hono.request{service:nusabank-biller,resource_name:post_/api/billers/payments,env:demo} > 4"
  message = "Top-up & bill payment p95 is {{value}}s (baseline ~0.3s). Usually one biller is the cause: see the per-biller latency monitor."
  monitor_thresholds {
    critical = 4
    warning  = 2
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "latency_login" {
  name    = "[Nusa Bank] Slow login (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.hono.request{service:nusabank-auth,resource_name:post_/api/auth/login,env:demo} > 1.5"
  message = "Login p95 is {{value}}s (baseline ~0.16s). Login hits the pg-channel/auth database: open DBM from the database span in the trace."
  monitor_thresholds {
    critical = 1.5
    warning  = 0.8
  }
  require_full_window = false
  tags                = local.monitor_tags
}

# ───────────── Third parties (peer.service) ─────────────

resource "datadog_monitor" "partner_ppob_latency" {
  name    = "[Nusa Bank] Biller {{peer.service.name}} is slow (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.ppob.request{env:demo} by {peer.service} > 3"
  message = <<-EOT
    Calls to **{{peer.service.name}}** through the PPOB aggregator have p95 {{value}}s (baseline ~0.45s).
    Payments beyond 8s go PENDING and are retried automatically; customer funds stay on hold.
  EOT
  monitor_thresholds {
    critical = 3
    warning  = 1.5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "partner_ppob_errors" {
  name    = "[Nusa Bank] Biller {{peer.service.name}} is failing"
  type    = "query alert"
  query   = "sum(last_10m):100 * default_zero(sum:trace.ppob.request.errors{env:demo} by {peer.service}.as_count()) / sum:trace.ppob.request.hits{env:demo} by {peer.service}.as_count() > 10"
  message = "{{value}}% of calls to **{{peer.service.name}}** failed in the last 10 minutes. Business impact: nusabank.biller.payment.count status:failed per biller on the dashboard."
  monitor_thresholds {
    critical = 10
    warning  = 3
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "partner_rail_latency" {
  name    = "[Nusa Bank] Rail {{peer.service.name}} is slow (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.partner.request{env:demo,!peer.service:credit-bureau} by {peer.service} > 3"
  message = "**{{peer.service.name}}** p95 is {{value}}s (baseline BI FAST ~0.2s, SKN ~0.15s). Transfers that failed on the rail can be retried by an operator from /ops."
  monitor_thresholds {
    critical = 3
    warning  = 1
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "partner_rail_errors" {
  name    = "[Nusa Bank] Rail {{peer.service.name}} is failing"
  type    = "query alert"
  query   = "sum(last_10m):100 * default_zero(sum:trace.partner.request.errors{env:demo,!peer.service:credit-bureau} by {peer.service}.as_count()) / sum:trace.partner.request.hits{env:demo,!peer.service:credit-bureau} by {peer.service}.as_count() > 10"
  message = "{{value}}% of calls to **{{peer.service.name}}** failed. Transfers end FAILED RAIL_UNAVAILABLE; once the rail recovers an operator can retry them from /ops."
  monitor_thresholds {
    critical = 10
    warning  = 3
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "partner_credit_bureau_latency" {
  name    = "[Nusa Bank] Credit bureau is slow (p95)"
  type    = "query alert"
  query   = "avg(last_30m):p95:trace.partner.request{env:demo,peer.service:credit-bureau} > 6"
  message = "Credit bureau p95 is {{value}}s. Credit decisions wait on the bureau; applications are kept and can be resubmitted."
  monitor_thresholds {
    critical = 6
    warning  = 4
  }
  require_full_window = false
  tags                = local.monitor_tags
}

# ───────────── Event pipeline ─────────────

resource "datadog_monitor" "kafka_lag" {
  name    = "[Nusa Bank] Consumer {{consumer_group.name}} lagging on {{topic.name}}"
  type    = "query alert"
  query   = "max(last_10m):max:data_streams.kafka.lag_seconds{env:demo} by {consumer_group,topic} > 60"
  message = <<-EOT
    **{{consumer_group.name}}** is {{value}}s behind on topic {{topic.name}} (Data Streams Monitoring).
    Lag on ledger-worker or account-service means customer balances and statements update late.
  EOT
  monitor_thresholds {
    critical = 60
    warning  = 15
  }
  require_full_window = false
  tags                = local.monitor_tags
}

# ───────────── Observability coverage ─────────────

# A pod that misses the admission webhook runs without the tracer (node upgrades did this
# twice). ssi-guard recreates such pods every 5 minutes; untraced pods that survive more
# than one run need a person.
resource "datadog_monitor" "untraced_pods" {
  name    = "[Nusa Bank] Pods running without the Datadog tracer"
  type    = "log alert"
  query   = "logs(\"\\\"ssi guard run\\\" @untraced:>0\").index(\"*\").rollup(\"count\").last(\"15m\") > 1"
  message = <<-EOT
    ssi-guard found pods without the Datadog tracer in more than one run (15 minutes). Traces and correlation
    for that service are missing. Check: kubectl get pods -n nusabank -l nusabank.io/lang and the ssi-guard CronJob logs.
  EOT
  monitor_thresholds {
    critical = 1
  }
  tags = local.monitor_tags
}

output "monitor_ids" {
  value = {
    api_errors_java  = datadog_monitor.api_errors_java.id
    api_errors_node  = datadog_monitor.api_errors_node.id
    api_errors_pay   = datadog_monitor.api_errors_payment.id
    latency_transfer = datadog_monitor.latency_transfer.id
    latency_bill     = datadog_monitor.latency_bill_payment.id
    latency_login    = datadog_monitor.latency_login.id
    ppob_latency     = datadog_monitor.partner_ppob_latency.id
    ppob_errors      = datadog_monitor.partner_ppob_errors.id
    rail_latency     = datadog_monitor.partner_rail_latency.id
    rail_errors      = datadog_monitor.partner_rail_errors.id
    bureau_latency   = datadog_monitor.partner_credit_bureau_latency.id
    kafka_lag        = datadog_monitor.kafka_lag.id
    untraced_pods    = datadog_monitor.untraced_pods.id
  }
}
