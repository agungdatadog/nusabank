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
  name    = "[Nusa Bank] Error rate API tinggi di {{service.name}} (Java)"
  type    = "query alert"
  query   = "sum(last_15m):100 * default_zero(sum:trace.servlet.request.errors{env:demo} by {service}.as_count()) / sum:trace.servlet.request.hits{env:demo} by {service}.as_count() > 10"
  message = <<-EOT
    Lebih dari {{threshold}}% request ke **{{service.name}}** gagal dalam 15 menit terakhir ({{value}}%).
    Mulai dari APM → {{service.name}} → Errors; trace membawa usr.id (CIF) dan partner.name bila penyebabnya di hilir.
  EOT
  monitor_thresholds {
    critical = 10
    warning  = 5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "api_errors_node" {
  name    = "[Nusa Bank] Error rate API tinggi di {{service.name}} (Node)"
  type    = "query alert"
  query   = "sum(last_15m):100 * default_zero(sum:trace.hono.request.errors{env:demo} by {service}.as_count()) / sum:trace.hono.request.hits{env:demo} by {service}.as_count() > 10"
  message = <<-EOT
    Lebih dari {{threshold}}% request ke **{{service.name}}** gagal dalam 15 menit terakhir ({{value}}%).
    Mulai dari APM → {{service.name}} → Errors; trace membawa usr.id (CIF) dan partner.name bila penyebabnya di hilir.
  EOT
  monitor_thresholds {
    critical = 10
    warning  = 5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "api_errors_payment" {
  name    = "[Nusa Bank] Error rate kirim transfer tinggi (payment-service)"
  type    = "query alert"
  query   = "sum(last_15m):100 * default_zero(sum:trace.http.request.errors{service:nusabank-payment,resource_name:post_/api/transfers,env:demo}.as_count()) / sum:trace.http.request.hits{service:nusabank-payment,resource_name:post_/api/transfers,env:demo}.as_count() > 10"
  message = <<-EOT
    {{value}}% transfer gagal dikirim dalam 15 menit terakhir. Cek monitor partner BI FAST / SKN — kegagalan rail
    muncul di sini sebagai 502/503 dengan partner.name pada span dan log.
  EOT
  monitor_thresholds {
    critical = 10
    warning  = 5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

# ───────────── Customer-facing latency of the key flows ─────────────

resource "datadog_monitor" "latency_transfer" {
  name    = "[Nusa Bank] Kirim transfer lambat (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.http.request{service:nusabank-payment,resource_name:post_/api/transfers,env:demo} > 3"
  message = "p95 kirim transfer {{value}} detik (baseline ±0,1 detik). Lihat latensi partner BI FAST/SKN dan span database di trace."
  monitor_thresholds {
    critical = 3
    warning  = 1.5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "latency_bill_payment" {
  name    = "[Nusa Bank] Bayar tagihan lambat (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.hono.request{service:nusabank-biller,resource_name:post_/api/billers/payments,env:demo} > 4"
  message = "p95 pembayaran top up & tagihan {{value}} detik (baseline ±0,3 detik). Biasanya penyebabnya biller tertentu: lihat monitor latensi per biller."
  monitor_thresholds {
    critical = 4
    warning  = 2
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "latency_login" {
  name    = "[Nusa Bank] Login lambat (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.hono.request{service:nusabank-auth,resource_name:post_/api/auth/login,env:demo} > 1.5"
  message = "p95 login {{value}} detik (baseline ±0,16 detik). Login menyentuh database pg-channel/auth: buka DBM dari span database di trace."
  monitor_thresholds {
    critical = 1.5
    warning  = 0.8
  }
  require_full_window = false
  tags                = local.monitor_tags
}

# ───────────── Third parties (peer.service) ─────────────

resource "datadog_monitor" "partner_ppob_latency" {
  name    = "[Nusa Bank] Biller {{peer.service.name}} lambat (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.ppob.request{env:demo} by {peer.service} > 3"
  message = <<-EOT
    Panggilan ke **{{peer.service.name}}** lewat agregator PPOB p95 {{value}} detik (baseline ±0,45 detik).
    Pembayaran yang melewati 8 detik menjadi PENDING dan dicoba ulang otomatis; dana nasabah tetap di-hold.
  EOT
  monitor_thresholds {
    critical = 3
    warning  = 1.5
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "partner_ppob_errors" {
  name    = "[Nusa Bank] Biller {{peer.service.name}} gagal"
  type    = "query alert"
  query   = "sum(last_10m):100 * default_zero(sum:trace.ppob.request.errors{env:demo} by {peer.service}.as_count()) / sum:trace.ppob.request.hits{env:demo} by {peer.service}.as_count() > 10"
  message = "{{value}}% panggilan ke **{{peer.service.name}}** gagal dalam 10 menit terakhir. Dampak bisnis: nusabank.biller.payment.count status:failed per biller di dashboard."
  monitor_thresholds {
    critical = 10
    warning  = 3
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "partner_rail_latency" {
  name    = "[Nusa Bank] Rail {{peer.service.name}} lambat (p95)"
  type    = "query alert"
  query   = "avg(last_10m):p95:trace.partner.request{env:demo,!peer.service:credit-bureau} by {peer.service} > 3"
  message = "**{{peer.service.name}}** p95 {{value}} detik (baseline BI FAST ±0,2 detik, SKN ±0,15 detik). Transfer yang gagal karena rail dapat diulang operator dari /ops."
  monitor_thresholds {
    critical = 3
    warning  = 1
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "partner_rail_errors" {
  name    = "[Nusa Bank] Rail {{peer.service.name}} gagal"
  type    = "query alert"
  query   = "sum(last_10m):100 * default_zero(sum:trace.partner.request.errors{env:demo,!peer.service:credit-bureau} by {peer.service}.as_count()) / sum:trace.partner.request.hits{env:demo,!peer.service:credit-bureau} by {peer.service}.as_count() > 10"
  message = "{{value}}% panggilan ke **{{peer.service.name}}** gagal. Transfer berstatus FAILED RAIL_UNAVAILABLE; setelah rail pulih, operator dapat mengulangnya dari /ops."
  monitor_thresholds {
    critical = 10
    warning  = 3
  }
  require_full_window = false
  tags                = local.monitor_tags
}

resource "datadog_monitor" "partner_credit_bureau_latency" {
  name    = "[Nusa Bank] Biro kredit lambat (p95)"
  type    = "query alert"
  query   = "avg(last_30m):p95:trace.partner.request{env:demo,peer.service:credit-bureau} > 6"
  message = "Biro kredit p95 {{value}} detik. Keputusan kredit menunggu biro; pengajuan tetap tersimpan dan dapat dikirim ulang."
  monitor_thresholds {
    critical = 6
    warning  = 4
  }
  require_full_window = false
  tags                = local.monitor_tags
}

# ───────────── Event pipeline ─────────────

resource "datadog_monitor" "kafka_lag" {
  name    = "[Nusa Bank] Konsumen {{consumer_group.name}} tertinggal di {{topic.name}}"
  type    = "query alert"
  query   = "max(last_10m):max:data_streams.kafka.lag_seconds{env:demo} by {consumer_group,topic} > 60"
  message = <<-EOT
    **{{consumer_group.name}}** tertinggal {{value}} detik di topik {{topic.name}} (Data Streams Monitoring).
    Lag di ledger-worker atau account-service berarti saldo dan mutasi nasabah terlambat diperbarui.
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
  name    = "[Nusa Bank] Pod berjalan tanpa tracer Datadog"
  type    = "log alert"
  query   = "logs(\"\\\"ssi guard run\\\" @untraced:>0\").index(\"*\").rollup(\"count\").last(\"15m\") > 1"
  message = <<-EOT
    ssi-guard menemukan pod tanpa tracer Datadog di lebih dari satu putaran (15 menit). Trace dan korelasi
    layanan itu hilang. Cek: kubectl get pods -n nusabank -l nusabank.io/lang dan log CronJob ssi-guard.
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
