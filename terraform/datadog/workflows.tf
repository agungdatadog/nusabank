# EP2 Workflow Automation: when BI FAST's error monitor alerts, take BI FAST out of service
# so customers are steered to SKN instead of failing at the partner. Turning it back on is a
# person's decision: /ops → Rail, or the "Pulihkan BI FAST" workflow below.
# Both call admin-service as operator ops.otomasi (token minted by
# tools/workflow/mint-operator-token.py), so every switch lands in the bank's audit log.

data "google_secret_manager_secret_version" "workflow_operator_token" {
  secret = "indowebinar-workflow-operator-token"
}

resource "datadog_action_connection" "nusabank_ops" {
  name = "Nusa Bank Back Office (ops.otomasi)"
  tags = ["team:nusabank", "env:demo"]

  http {
    base_url = var.base_url
    token_auth {
      token {
        name  = "operatorToken"
        type  = "SECRET"
        value = data.google_secret_manager_secret_version.workflow_operator_token.secret_data
      }
      header {
        name  = "Authorization"
        value = "Bearer {{ operatorToken }}"
      }
    }
  }
}

# Datadog actions need a Datadog connection, which has no Terraform resource; post change
# events to the Events intake over HTTP instead, with the API key the provider already reads.
resource "datadog_action_connection" "datadog_events" {
  name = "Nusa Bank Datadog Events intake"
  tags = ["team:nusabank", "env:demo"]

  http {
    base_url = "https://event-management-intake.datadoghq.com"
    token_auth {
      token {
        name  = "apiKey"
        type  = "SECRET"
        value = data.google_secret_manager_secret_version.dd_api_key.secret_data
      }
      header {
        name  = "DD-API-KEY"
        value = "{{ apiKey }}"
      }
    }
  }
}

locals {
  workflow_tags = ["team:nusabank", "env:demo", "service:nusabank-payment", "managed-by:terraform"]
  ops_connection = {
    env = "default"
    connections = [
      { connectionId = datadog_action_connection.nusabank_ops.id, label = "INTEGRATION_NUSABANK_OPS" },
      { connectionId = datadog_action_connection.datadog_events.id, label = "INTEGRATION_DATADOG_EVENTS" },
    ]
  }

  # A change event on nusabank-payment: shows in Change Tracking on the service page and
  # in the incident timeline next to the monitor that caused it.
  rail_change_event = {
    for state, v in {
      disabled = { status = "BI FAST dinonaktifkan otomatis", available = false }
      enabled  = { status = "BI FAST diaktifkan kembali", available = true }
      } : state => {
      category = "change"
      title    = v.status
      tags     = ["env:demo", "service:nusabank-payment", "rail:bifast", "team:nusabank"]
      attributes = {
        changed_resource   = { name = "rail:BIFAST", type = "configuration" }
        impacted_resources = [{ name = "nusabank-payment", type = "service" }]
        prev_value         = { available = !v.available }
        new_value          = { available = v.available }
      }
    }
  }
}

resource "datadog_workflow_automation" "bifast_auto_disable" {
  name        = "[Nusa Bank] Nonaktifkan BI FAST saat gangguan"
  description = "Triggered by the 'Rail bifast is failing' monitor. Takes BI FAST out of service for new transfers (customers see it greyed out and use SKN), records a change event. Re-enabling is manual."
  published   = true
  tags        = local.workflow_tags

  spec_json = jsonencode({
    handle         = "nusabank-bifast-auto-disable"
    connectionEnvs = [local.ops_connection]
    triggers = [{
      monitorTrigger = { rateLimit = { count = 1, interval = "300s" } }
      startStepNames = ["Is_BI_FAST_alert"]
    }]
    steps = [
      {
        name     = "Is_BI_FAST_alert"
        actionId = "com.datadoghq.core.if"
        parameters = [
          { name = "joinOperator", value = "and" },
          { name = "conditions", value = [
            { comparisonOperator = "contains", leftValue = "{{ Source.monitor.event.tags }}", rightValue = "peer.service:bifast" },
          ] },
        ]
        outboundEdges = [{ branchName = "true", nextStepName = "Disable_BI_FAST" }]
      },
      {
        name            = "Disable_BI_FAST"
        actionId        = "com.datadoghq.http.request"
        connectionLabel = "INTEGRATION_NUSABANK_OPS"
        parameters = [
          { name = "verb", value = "PUT" },
          { name = "url", value = "${var.base_url}/api/admin/rails/BIFAST/availability" },
          { name = "requestHeaders", value = [{ key = "Content-Type", value = ["application/json"] }] },
          { name = "body", value = jsonencode({
            available                 = false
            reason                    = "Otomatis: monitor \"Rail bifast is failing\" alert"
            auto_enable_after_minutes = 120
          }) },
          { name = "responseParsing", value = "json" },
        ]
        outboundEdges = [{ branchName = "main", nextStepName = "Record_change" }]
      },
      {
        name            = "Record_change"
        actionId        = "com.datadoghq.http.request"
        connectionLabel = "INTEGRATION_DATADOG_EVENTS"
        parameters = [
          { name = "verb", value = "POST" },
          { name = "url", value = "https://event-management-intake.datadoghq.com/api/v2/events" },
          { name = "requestHeaders", value = [{ key = "Content-Type", value = ["application/json"] }] },
          { name = "body", value = jsonencode({ data = { type = "event", attributes = merge(local.rail_change_event.disabled, {
            message = "Datadog Workflow menonaktifkan BI FAST untuk transfer baru karena monitor {{ Source.monitor.name }} alert. Nasabah diarahkan ke SKN. Aktif otomatis kembali {{ Steps.Disable_BI_FAST.body.auto_enable_at }} jika tidak diaktifkan manual dari /ops."
            attributes = merge(local.rail_change_event.disabled.attributes, {
              author = { name = "Datadog Workflow", type = "automation" }
            })
          }) } }) },
          { name = "responseParsing", value = "json" },
        ]
      },
    ]
  })
}

resource "datadog_workflow_automation" "bifast_restore" {
  name        = "[Nusa Bank] Pulihkan BI FAST"
  description = "Run by an operator once the BI FAST error monitor has recovered: puts BI FAST back in service and records a change event."
  published   = true
  tags        = local.workflow_tags

  spec_json = jsonencode({
    connectionEnvs = [local.ops_connection]
    triggers = [{
      workflowTrigger = {}
      startStepNames  = ["Enable_BI_FAST"]
    }]
    steps = [
      {
        name            = "Enable_BI_FAST"
        actionId        = "com.datadoghq.http.request"
        connectionLabel = "INTEGRATION_NUSABANK_OPS"
        parameters = [
          { name = "verb", value = "PUT" },
          { name = "url", value = "${var.base_url}/api/admin/rails/BIFAST/availability" },
          { name = "requestHeaders", value = [{ key = "Content-Type", value = ["application/json"] }] },
          { name = "body", value = "{\"available\": true, \"reason\": \"Diaktifkan kembali oleh {{ Source.initiator.name }} via Datadog Workflow\"}" },
          { name = "responseParsing", value = "json" },
        ]
        outboundEdges = [{ branchName = "main", nextStepName = "Record_change" }]
      },
      {
        name            = "Record_change"
        actionId        = "com.datadoghq.http.request"
        connectionLabel = "INTEGRATION_DATADOG_EVENTS"
        parameters = [
          { name = "verb", value = "POST" },
          { name = "url", value = "https://event-management-intake.datadoghq.com/api/v2/events" },
          { name = "requestHeaders", value = [{ key = "Content-Type", value = ["application/json"] }] },
          { name = "body", value = jsonencode({ data = { type = "event", attributes = merge(local.rail_change_event.enabled, {
            message = "{{ Source.initiator.name }} mengaktifkan kembali BI FAST setelah partner pulih."
            attributes = merge(local.rail_change_event.enabled.attributes, {
              author = { name = "{{ Source.initiator.name }}", type = "user" }
            })
          }) } }) },
          { name = "responseParsing", value = "json" },
        ]
      },
    ]
  })
}

# ─────────── EP2 Part 1: Digital Channels switches GoPay off and on, by hand ───────────
# Unlike BI FAST, nothing triggers these automatically: the owning team decides during the
# Partner outage incident and runs them from the "Digital Channels — Top Up & Tagihan"
# dashboard. Same connection as BI FAST, so each switch is audited as ops.otomasi with the
# Datadog user who ran it in the reason.

locals {
  channels_workflow_tags = ["team:nusabank-channels", "env:demo", "service:nusabank-biller", "managed-by:terraform"]

  gopay_change_event = {
    for state, v in {
      disabled = { status = "GoPay dinonaktifkan di Top Up & Tagihan", available = false }
      enabled  = { status = "GoPay diaktifkan kembali di Top Up & Tagihan", available = true }
      } : state => {
      category = "change"
      title    = v.status
      tags     = ["env:demo", "service:nusabank-biller", "biller:gopay", "team:nusabank-channels"]
      attributes = {
        changed_resource   = { name = "biller:gopay", type = "configuration" }
        impacted_resources = [{ name = "nusabank-biller", type = "service" }]
        prev_value         = { available = !v.available }
        new_value          = { available = v.available }
        author             = { name = "{{ Source.initiator.name }}", type = "user" }
      }
    }
  }

  gopay_switch = {
    disable = {
      name        = "[Nusa Bank] Nonaktifkan GoPay"
      description = "Digital Channels, during a GoPay partner outage: takes GoPay out of Top Up & Tagihan (customers see it greyed out and pick another e-wallet) and records a change event. biller-service keeps checking GoPay in the background so recovery shows in the data. Turns itself back on after 2 hours if nobody does."
      available   = false
      reason      = "Dinonaktifkan oleh {{ Source.initiator.name }} (Digital Channels): GoPay gagal di partner"
      message     = "{{ Source.initiator.name }} menonaktifkan GoPay di Top Up & Tagihan selama gangguan partner. Nasabah diarahkan ke e-wallet lain; tidak ada dana yang berpindah. Aktif otomatis kembali {{ Steps.Switch_GoPay.body.auto_enable_at }} jika tidak diaktifkan manual."
    }
    enable = {
      name        = "[Nusa Bank] Aktifkan kembali GoPay"
      description = "Digital Channels, once the GoPay error rate is back to zero: puts GoPay back in Top Up & Tagihan and records a change event."
      available   = true
      reason      = "Diaktifkan kembali oleh {{ Source.initiator.name }} (Digital Channels) setelah partner pulih"
      message     = "{{ Source.initiator.name }} mengaktifkan kembali GoPay di Top Up & Tagihan setelah error rate GoPay kembali normal."
    }
  }
}

resource "datadog_workflow_automation" "gopay_switch" {
  for_each = local.gopay_switch

  name        = each.value.name
  description = each.value.description
  published   = true
  tags        = local.channels_workflow_tags

  spec_json = jsonencode({
    connectionEnvs = [local.ops_connection]
    triggers = [{
      workflowTrigger = {}
      startStepNames  = ["Switch_GoPay"]
    }]
    steps = [
      {
        name            = "Switch_GoPay"
        actionId        = "com.datadoghq.http.request"
        connectionLabel = "INTEGRATION_NUSABANK_OPS"
        parameters = [
          { name = "verb", value = "PUT" },
          { name = "url", value = "${var.base_url}/api/admin/billers/gopay/availability" },
          { name = "requestHeaders", value = [{ key = "Content-Type", value = ["application/json"] }] },
          { name = "body", value = jsonencode({ available = each.value.available, reason = each.value.reason }) },
          { name = "responseParsing", value = "json" },
        ]
        outboundEdges = [{ branchName = "main", nextStepName = "Record_change" }]
      },
      {
        name            = "Record_change"
        actionId        = "com.datadoghq.http.request"
        connectionLabel = "INTEGRATION_DATADOG_EVENTS"
        parameters = [
          { name = "verb", value = "POST" },
          { name = "url", value = "https://event-management-intake.datadoghq.com/api/v2/events" },
          { name = "requestHeaders", value = [{ key = "Content-Type", value = ["application/json"] }] },
          { name = "body", value = jsonencode({ data = { type = "event", attributes = merge(
            local.gopay_change_event[each.key == "disable" ? "disabled" : "enabled"],
            { message = each.value.message },
          ) } }) },
          { name = "responseParsing", value = "json" },
        ]
      },
    ]
  })
}
