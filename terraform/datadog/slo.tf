# SLOs measure customer journeys, not services: a customer cares whether login, checking a
# balance, sending a transfer or paying a bill works — not which service failed. Datadog has
# no composite SLO type, so the umbrella SLO sums good and total events of all four journey
# endpoints in one metric-based query. Errors come from APM (5xx) only: business counters
# such as nusabank.transfer.count{status:failed} include legitimate rejections (insufficient
# balance), which are not reliability failures. Measured baseline 2026-10-12..28: 99.9996%.

locals {
  slo_tags = ["team:nusabank", "env:demo", "managed-by:terraform"]

  # Journey entry endpoints; the APM server operation differs per runtime.
  journeys = {
    login = {
      title     = "Login"
      operation = "hono.request"
      filter    = "service:nusabank-auth,resource_name:post_/api/auth/login,env:demo"
      p95_max   = 1 # seconds; baseline p95 ~0.2 s
    }
    saldo = {
      title     = "Balance check"
      operation = "servlet.request"
      filter    = "service:nusabank-account,resource_name:get_/api/accounts,env:demo"
      p95_max   = 1 # baseline ~0.09 s, rare spikes to ~1.1 s
    }
    transfer = {
      title     = "Send transfer"
      operation = "http.request"
      filter    = "service:nusabank-payment,resource_name:post_/api/transfers,env:demo"
      p95_max   = 2 # baseline ~0.5 s; includes the BI FAST round trip
    }
    tagihan = {
      title     = "Top-up & bill payment"
      operation = "hono.request"
      filter    = "service:nusabank-biller,resource_name:post_/api/billers/payments,env:demo"
      p95_max   = 2 # baseline ~0.75 s; includes the PPOB round trip
    }
  }

  # good = hits - errors; default_zero because a healthy endpoint emits no error points.
  journey_good  = { for k, j in local.journeys : k => "sum:trace.${j.operation}.hits{${j.filter}}.as_count() - default_zero(sum:trace.${j.operation}.errors{${j.filter}}.as_count())" }
  journey_total = { for k, j in local.journeys : k => "sum:trace.${j.operation}.hits{${j.filter}}.as_count()" }
}

# ───────────── Umbrella: all critical journeys together ─────────────

resource "datadog_service_level_objective" "digital_banking" {
  name        = "Nusa Bank Digital — critical journeys available"
  type        = "metric"
  description = "Login, balance check, send transfer, and top-up & bill payment combined: share of requests that succeed (no 5xx). Managed by Terraform."

  query {
    numerator   = join(" + ", [for k in keys(local.journeys) : "(${local.journey_good[k]})"])
    denominator = join(" + ", [for k in keys(local.journeys) : local.journey_total[k]])
  }

  thresholds {
    timeframe = "30d"
    target    = 99.9
    warning   = 99.95
  }
  thresholds {
    timeframe = "7d"
    target    = 99.9
    warning   = 99.95
  }

  tags = concat(local.slo_tags, ["journey:all", "slo:umbrella"])
}

# ───────────── Per journey: availability and latency ─────────────

resource "datadog_service_level_objective" "journey_availability" {
  for_each = local.journeys

  name        = "Nusa Bank — ${each.value.title}: available"
  type        = "metric"
  description = "Share of ${each.value.title} requests that succeed (no 5xx). Managed by Terraform."

  query {
    numerator   = local.journey_good[each.key]
    denominator = local.journey_total[each.key]
  }

  thresholds {
    timeframe = "30d"
    target    = 99.9
    warning   = 99.95
  }
  thresholds {
    timeframe = "7d"
    target    = 99.9
    warning   = 99.95
  }

  tags = concat(local.slo_tags, ["journey:${each.key}", "slo:availability"])
}

resource "datadog_service_level_objective" "journey_latency" {
  for_each = local.journeys

  name        = "Nusa Bank — ${each.value.title}: fast (p95 < ${each.value.p95_max}s)"
  type        = "time_slice"
  description = "Share of 5-minute slices where ${each.value.title} p95 stays under ${each.value.p95_max}s. Managed by Terraform."

  sli_specification {
    time_slice {
      comparator             = "<"
      threshold              = each.value.p95_max
      query_interval_seconds = 300
      query {
        formula {
          formula_expression = "query1"
        }
        query {
          metric_query {
            name  = "query1"
            query = "p95:trace.${each.value.operation}{${each.value.filter}}"
          }
        }
      }
    }
  }

  thresholds {
    timeframe = "30d"
    target    = 99
    warning   = 99.5
  }
  thresholds {
    timeframe = "7d"
    target    = 99
    warning   = 99.5
  }

  tags = concat(local.slo_tags, ["journey:${each.key}", "slo:latency"])
}

# ───────────── Third parties: "our failure" vs "partner failure" ─────────────
# Grouped by peer.service, so each biller and rail has its own status and error budget.
# The credit bureau is left out: tens of calls a day make any ratio meaningless.

resource "datadog_service_level_objective" "partner_ppob" {
  name        = "Nusa Bank — PPOB billers available (per biller)"
  type        = "metric"
  description = "Share of calls to each biller through the PPOB aggregator that succeed, per peer.service. Managed by Terraform."

  query {
    numerator   = "sum:trace.ppob.request.hits{env:demo,peer.service:ppob-*} by {peer.service}.as_count() - default_zero(sum:trace.ppob.request.errors{env:demo,peer.service:ppob-*} by {peer.service}.as_count())"
    denominator = "sum:trace.ppob.request.hits{env:demo,peer.service:ppob-*} by {peer.service}.as_count()"
  }

  thresholds {
    timeframe = "30d"
    target    = 99.5
    warning   = 99.8
  }
  thresholds {
    timeframe = "7d"
    target    = 99.5
    warning   = 99.8
  }

  tags = concat(local.slo_tags, ["journey:tagihan", "slo:partner"])
}

resource "datadog_service_level_objective" "partner_rails" {
  name        = "Nusa Bank — Transfer rails available (BI FAST, SKN)"
  type        = "metric"
  description = "Share of calls to BI FAST and SKN that succeed, per peer.service. Managed by Terraform."

  query {
    numerator   = "sum:trace.partner.request.hits{env:demo,!peer.service:credit-bureau} by {peer.service}.as_count() - default_zero(sum:trace.partner.request.errors{env:demo,!peer.service:credit-bureau} by {peer.service}.as_count())"
    denominator = "sum:trace.partner.request.hits{env:demo,!peer.service:credit-bureau} by {peer.service}.as_count()"
  }

  thresholds {
    timeframe = "30d"
    target    = 99.5
    warning   = 99.8
  }
  thresholds {
    timeframe = "7d"
    target    = 99.5
    warning   = 99.8
  }

  tags = concat(local.slo_tags, ["journey:transfer", "slo:partner"])
}

# ───────────── Burn-rate alerts on the umbrella SLO ─────────────
# Multi-window (Google SRE workbook): fast burn spends 2% of the 30-day budget in an hour,
# slow burn 5% in six hours. Short windows stop the alert as soon as the burn stops.

resource "datadog_monitor" "slo_fast_burn" {
  name    = "[Nusa Bank] Critical journeys SLO: fast error budget burn"
  type    = "slo alert"
  query   = "burn_rate(\"${datadog_service_level_objective.digital_banking.id}\").over(\"30d\").long_window(\"1h\").short_window(\"5m\") > 14.4"
  message = <<-EOT
    The "Nusa Bank Digital — critical journeys available" error budget is burning {{value}}x faster than allowed.
    At this rate the 30-day budget is gone in about 2 days. Check the per-journey SLOs to find the failing journey,
    then the partner SLOs to see whether the cause is ours or BI FAST / a biller.
  EOT
  monitor_thresholds {
    critical = 14.4
  }
  tags = local.monitor_tags
}

resource "datadog_monitor" "slo_slow_burn" {
  name    = "[Nusa Bank] Critical journeys SLO: slow error budget burn"
  type    = "slo alert"
  query   = "burn_rate(\"${datadog_service_level_objective.digital_banking.id}\").over(\"30d\").long_window(\"6h\").short_window(\"30m\") > 6"
  message = <<-EOT
    The "Nusa Bank Digital — critical journeys available" error budget has burned {{value}}x faster than allowed
    for 6 hours. Not a sudden incident, but it will exhaust the budget in about 5 days if left alone.
  EOT
  monitor_thresholds {
    critical = 6
  }
  tags = local.monitor_tags
}

output "slo_ids" {
  value = merge(
    { umbrella = datadog_service_level_objective.digital_banking.id, partner_ppob = datadog_service_level_objective.partner_ppob.id, partner_rails = datadog_service_level_objective.partner_rails.id },
    { for k, s in datadog_service_level_objective.journey_availability : "availability_${k}" => s.id },
    { for k, s in datadog_service_level_objective.journey_latency : "latency_${k}" => s.id },
  )
}
